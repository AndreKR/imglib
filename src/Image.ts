import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Color, colorToCss, colorToSharp } from "./Color.js";
import { Font, fontToSharp, SharpFont } from "./Font.js";

export type ImageSource =
  | { kind: "file"; path: string }
  | { kind: "buffer"; buffer: Buffer }
  | { kind: "blank"; width: number; height: number; color: Color }
  | { kind: "blankLike"; image: Image; color: Color }
  | { kind: "svg"; svg: string | Buffer };

export interface FileOptions {
  path: string | URL;
}

export interface BufferOptions {
  buffer: Buffer | Uint8Array;
}

export interface SvgOptions {
  svg: string | Buffer;
}

export interface SvgMarkupOptions {
  markup: string;
  /** Font files to register before rendering the SVG markup. */
  fonts?: readonly Font[];
}

export type ResizeKernel = "nearest" | "cubic" | "mitchell" | "lanczos2" | "lanczos3";

export interface ResizeOptions {
  width?: number;
  height?: number;
  keep_aspect_ratio?: boolean;
  enlarge?: boolean;
  mode?: "contain" | "cover";
  kernel?: ResizeKernel;
}

export interface CropOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  outside?: Color;
}

export interface OverlayOptions {
  image: Image | MaskedImage;
  x: number;
  y: number;
  opacity?: number;
  mode?: "over" | "source";
}

export interface LineOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Color;
  width?: number;
}

interface RectStyleOptions {
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  strokePosition?: "center" | "inside" | "outside";
  radius?: number;
}

interface RectSizeOptions extends RectStyleOptions {
  /** X coordinate of the rectangle's upper-left corner. */
  x: number;

  /** Y coordinate of the rectangle's upper-left corner. */
  y: number;

  /** Rectangle width in pixels, extending to the right from x. */
  width: number;

  /** Rectangle height in pixels, extending downward from y. */
  height: number;

  x2?: never;
  y2?: never;
}

interface RectCornerOptions extends RectStyleOptions {
  /** X coordinate of one rectangle corner. */
  x: number;

  /** Y coordinate of one rectangle corner. */
  y: number;

  /** X coordinate of the opposite rectangle corner. May be smaller than x. */
  x2: number;

  /** Y coordinate of the opposite rectangle corner. May be smaller than y. */
  y2: number;

  width?: never;
  height?: never;
}

export type RectOptions = RectSizeOptions | RectCornerOptions;

export interface CircleOptions {
  cx: number;
  cy: number;
  r: number;
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
}

export interface TextOptions {
  value: string;
  x: number;
  y: number;
  /** Overrides the font's size. Required when the font has no size. */
  size?: number;
  color: Color;
  font?: Font;
  anchor?: "start" | "middle" | "end";
  /** How y is interpreted. Defaults to the text baseline. */
  verticalAnchor?: "baseline" | "text-top" | "font-top";
}

export interface BlankOptions {
  width: number;
  height: number;
  color?: Color;
}

export interface BlankLikeOptions {
  image: Image;
  color?: Color;
}

export interface AttachMaskOptions {
  mask: Image;
  /** The mask channel used as coverage. Defaults to alpha. */
  channel?: "alpha" | "luminance";
}

export interface ThresholdOptions {
  /** Threshold from 0 through 1. Defaults to 0.5. */
  threshold?: number;
}

export interface MidtoneOptions {
  /** Positive curve factor. Values above 1 brighten midtones; values below 1 darken them. */
  factor: number;
}

export interface OpacityOptions {
  opacity: number;
}

export interface PngOutputOptions {
  format: "png";
  compressionLevel?: number;
}

export interface JpegOutputOptions {
  format: "jpeg";
  quality?: number;
  chromaSubsampling?: "4:2:0" | "4:4:4";
}

export type OutputOptions = PngOutputOptions | JpegOutputOptions;
export type SaveOptions = OutputOptions & { path: string | URL };

export interface ImageMetadata {
  width: number;
  height: number;
  channels?: number;
  hasAlpha?: boolean;
  format?: string;
}

interface MaskedImageState {
  image: Image;
  mask: Image;
  channel: "alpha" | "luminance";
}

const maskedImageBrand: unique symbol = Symbol("MaskedImage");

/** An image with separate mask coverage, intended only for use as an overlay source. */
export interface MaskedImage {
  readonly [maskedImageBrand]: true;

  /** Returns the underlying image without applying the mask. */
  discardMask(): Image;
}

class AttachedMask implements MaskedImage {
  readonly [maskedImageBrand] = true;

  constructor(readonly state: MaskedImageState) {}

  discardMask(): Image {
    return this.state.image;
  }
}

type Step =
  | { kind: "resize"; options: ResizeOptions }
  | { kind: "crop"; options: CropOptions }
  | { kind: "overlay"; options: OverlayOptions }
  | { kind: "line"; options: LineOptions }
  | { kind: "rect"; options: RectOptions }
  | { kind: "circle"; options: CircleOptions }
  | { kind: "text"; options: TextOptions }
  | { kind: "svgMarkup"; options: SvgMarkupOptions }
  | { kind: "grayscale" }
  | { kind: "thresholdLuminance"; options: ThresholdOptions }
  | { kind: "thresholdChannels"; options: ThresholdOptions }
  | { kind: "thresholdAlpha"; options: ThresholdOptions }
  | { kind: "adjustMidtones"; options: MidtoneOptions }
  | { kind: "invert" }
  | { kind: "opacity"; opacity: number };

export class Image {
  private constructor(
    private readonly source: ImageSource,
    private readonly steps: readonly Step[] = []
  ) {}

  static file(options: FileOptions): Image {
    return new Image({ kind: "file", path: pathFromFileOption(options.path) });
  }

  static buffer(options: BufferOptions): Image {
    return new Image({ kind: "buffer", buffer: Buffer.from(options.buffer) });
  }

  static blank(options: BlankOptions): Image {
    return new Image({
      kind: "blank",
      width: options.width,
      height: options.height,
      color: options.color ?? Color.css({ value: "transparent" })
    });
  }

  static blankLike(options: BlankLikeOptions): Image {
    return new Image({
      kind: "blankLike",
      image: options.image,
      color: options.color ?? Color.css({ value: "transparent" })
    });
  }

  static svg(options: SvgOptions): Image {
    return new Image({ kind: "svg", svg: options.svg });
  }

  resize(options: ResizeOptions): Image {
    return this.withStep({ kind: "resize", options });
  }

  crop(options: CropOptions): Image {
    return this.withStep({ kind: "crop", options });
  }

  overlay(options: OverlayOptions): Image {
    return this.withStep({ kind: "overlay", options });
  }

  drawLine(options: LineOptions): Image {
    return this.withStep({ kind: "line", options });
  }

  drawRect(options: RectOptions): Image {
    return this.withStep({ kind: "rect", options });
  }

  drawCircle(options: CircleOptions): Image {
    return this.withStep({ kind: "circle", options });
  }

  drawText(options: TextOptions): Image {
    return this.withStep({ kind: "text", options });
  }

  drawSvgMarkup(options: SvgMarkupOptions): Image {
    return this.withStep({ kind: "svgMarkup", options });
  }

  grayscale(): Image {
    return this.withStep({ kind: "grayscale" });
  }

  thresholdLuminance(options: ThresholdOptions = {}): Image {
    return this.withStep({ kind: "thresholdLuminance", options });
  }

  thresholdChannels(options: ThresholdOptions = {}): Image {
    return this.withStep({ kind: "thresholdChannels", options });
  }

  thresholdAlpha(options: ThresholdOptions = {}): Image {
    return this.withStep({ kind: "thresholdAlpha", options });
  }

  adjustMidtones(options: MidtoneOptions): Image {
    return this.withStep({ kind: "adjustMidtones", options });
  }

  invert(): Image {
    return this.withStep({ kind: "invert" });
  }

  opacity(options: OpacityOptions): Image {
    return this.withStep({ kind: "opacity", opacity: options.opacity });
  }

  attachMask(options: AttachMaskOptions): MaskedImage {
    return new AttachedMask({
      image: this,
      mask: options.mask,
      channel: options.channel ?? "alpha"
    });
  }

  async save(options: SaveOptions): Promise<void> {
    const encoded = await encodeOutput(await this.materialize(), options);
    await writeFile(pathFromFileOption(options.path), encoded);
  }

  async toBuffer(options: OutputOptions): Promise<Buffer> {
    return encodeOutput(await this.materialize(), options);
  }

  async metadata(): Promise<ImageMetadata> {
    const metadata = await sharp(await this.materialize()).metadata();
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new Error("Unable to determine image dimensions.");
    }

    const result: ImageMetadata = {
      width: metadata.width,
      height: metadata.height
    };

    if (metadata.channels !== undefined) {
      result.channels = metadata.channels;
    }

    if (metadata.hasAlpha !== undefined) {
      result.hasAlpha = metadata.hasAlpha;
    }

    if (metadata.format !== undefined) {
      result.format = metadata.format;
    }

    return result;
  }

  private withStep(step: Step): Image {
    return new Image(this.source, [...this.steps, step]);
  }

  private async materialize(): Promise<Buffer> {
    let current = await this.sourceToBuffer();

    for (const step of this.steps) {
      current = await applyStep(current, step);
    }

    return current;
  }

  private async sourceToBuffer(): Promise<Buffer> {
    switch (this.source.kind) {
      case "file":
        return sharp(this.source.path).png().toBuffer();
      case "buffer":
        return sharp(this.source.buffer).png().toBuffer();
      case "blank":
        return blankBuffer(this.source.width, this.source.height, this.source.color);
      case "blankLike": {
        const { width, height } = await this.source.image.metadata();
        return blankBuffer(width, height, this.source.color);
      }
      case "svg":
        return sharp(Buffer.isBuffer(this.source.svg) ? this.source.svg : Buffer.from(this.source.svg))
          .png()
          .toBuffer();
    }
  }
}

async function encodeOutput(input: Buffer, options: OutputOptions): Promise<Buffer> {
  if (options.format === "png") {
    return sharp(input)
      .png({
        ...(options.compressionLevel === undefined ? {} : { compressionLevel: options.compressionLevel })
      })
      .toBuffer();
  }

  if (options.format === "jpeg") {
    return sharp(input)
      .jpeg({
        ...(options.quality === undefined ? {} : { quality: options.quality }),
        ...(options.chromaSubsampling === undefined ? {} : { chromaSubsampling: options.chromaSubsampling })
      })
      .toBuffer();
  }

  throw new Error("Output format must be png or jpeg.");
}

async function applyStep(input: Buffer, step: Step): Promise<Buffer> {
  switch (step.kind) {
    case "resize":
      return resize(input, step.options);
    case "crop":
      return crop(input, step.options);
    case "overlay":
      return overlay(input, step.options);
    case "line":
      return drawSvgMarkup(input, lineSvg(step.options));
    case "rect":
      return drawSvgMarkup(input, rectSvg(step.options));
    case "circle":
      return drawSvgMarkup(input, circleSvg(step.options));
    case "text":
      return drawText(input, step.options);
    case "svgMarkup":
      return drawSvgMarkup(input, step.options.markup, step.options.fonts);
    case "grayscale":
      return sharp(input).grayscale().png().toBuffer();
    case "thresholdLuminance":
      return thresholdLuminance(input, step.options);
    case "thresholdChannels":
      return thresholdChannels(input, step.options);
    case "thresholdAlpha":
      return thresholdAlpha(input, step.options);
    case "adjustMidtones":
      return adjustMidtones(input, step.options);
    case "invert":
      return sharp(input).negate({ alpha: false }).png().toBuffer();
    case "opacity":
      return applyOpacity(input, step.opacity);
  }
}

async function thresholdLuminance(input: Buffer, options: ThresholdOptions): Promise<Buffer> {
  const thresholded = await sharp(input)
    .removeAlpha()
    .grayscale()
    .threshold(pixelThreshold(options))
    .png()
    .toBuffer();

  return joinOriginalAlpha(input, thresholded);
}

async function thresholdChannels(input: Buffer, options: ThresholdOptions): Promise<Buffer> {
  const thresholded = await sharp(input)
    .removeAlpha()
    .threshold(pixelThreshold(options), { greyscale: false })
    .png()
    .toBuffer();

  return joinOriginalAlpha(input, thresholded);
}

async function thresholdAlpha(input: Buffer, options: ThresholdOptions): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  if (!metadata.hasAlpha) {
    return input;
  }

  const rgb = await sharp(input)
    .removeAlpha()
    .png()
    .toBuffer();
  const alpha = await sharp(input)
    .extractChannel("alpha")
    .threshold(pixelThreshold(options))
    .png()
    .toBuffer();

  return sharp(rgb)
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

async function joinOriginalAlpha(input: Buffer, output: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  if (!metadata.hasAlpha) {
    return output;
  }

  const alpha = await sharp(input)
    .extractChannel("alpha")
    .png()
    .toBuffer();

  return sharp(output)
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

function pixelThreshold(options: ThresholdOptions): number {
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Threshold must be a finite number between 0 and 1.");
  }

  return Math.ceil(threshold * 255);
}

async function adjustMidtones(input: Buffer, options: MidtoneOptions): Promise<Buffer> {
  if (!Number.isFinite(options.factor) || options.factor <= 0) {
    throw new Error("Midtone factor must be a positive finite number.");
  }
  if (options.factor === 1) {
    return input;
  }

  const { data, info } = await sharp(input)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  const colorChannels = info.channels < 3 ? 1 : 3;

  for (let offset = 0; offset < output.length; offset += info.channels) {
    for (let channel = 0; channel < colorChannels; channel += 1) {
      const normalized = output[offset + channel]! / 255;
      output[offset + channel] = Math.round(255 * normalized ** (1 / options.factor));
    }
  }

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
    .png()
    .toBuffer();
}

async function resize(input: Buffer, options: ResizeOptions): Promise<Buffer> {
  if (options.width === undefined && options.height === undefined) {
    throw new Error("Resize requires width, height, or both.");
  }

  const keepAspectRatio = options.keep_aspect_ratio ?? true;
  const mode = options.mode ?? "contain";

  return sharp(input)
    .resize(options.width, options.height, {
      fit: keepAspectRatio ? mode : "fill",
      withoutEnlargement: options.enlarge === false,
      kernel: options.kernel
    })
    .png()
    .toBuffer();
}

async function crop(input: Buffer, options: CropOptions): Promise<Buffer> {
  const normalized = await sharp(input)
    .ensureAlpha()
    .extend({
      left: Math.max(0, -options.x),
      top: Math.max(0, -options.y),
      right: Math.max(0, options.x + options.width - (await dimensions(input)).width),
      bottom: Math.max(0, options.y + options.height - (await dimensions(input)).height),
      background: colorToSharp(options.outside ?? Color.css({ value: "transparent" }))
    })
    .png()
    .toBuffer();

  return sharp(normalized)
    .extract({
      left: Math.max(0, options.x),
      top: Math.max(0, options.y),
      width: options.width,
      height: options.height
    })
    .png()
    .toBuffer();
}

async function overlay(input: Buffer, options: OverlayOptions): Promise<Buffer> {
  const base = await dimensions(input);
  const source = await overlaySource(options.image);
  let overlayBuffer = source.image;

  if (options.opacity !== undefined) {
    overlayBuffer = await applyOpacity(overlayBuffer, options.opacity);
  }

  const over = await dimensions(overlayBuffer);
  let coverage = source.mask === undefined ? undefined : await maskCoverage(source.mask, source.channel!);

  if (coverage !== undefined && (coverage.width !== over.width || coverage.height !== over.height)) {
    throw new Error(
      `Mask dimensions must match the masked image: image is ${over.width}x${over.height}, mask is ${coverage.width}x${coverage.height}.`
    );
  }

  if (coverage !== undefined && options.mode !== "source") {
    overlayBuffer = await applyCoverageToAlpha(overlayBuffer, coverage.data);
    coverage = undefined;
  }

  const left = Math.max(0, options.x);
  const top = Math.max(0, options.y);
  const cropLeft = Math.max(0, -options.x);
  const cropTop = Math.max(0, -options.y);
  const visibleWidth = Math.min(over.width - cropLeft, base.width - left);
  const visibleHeight = Math.min(over.height - cropTop, base.height - top);

  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return input;
  }

  const clipped = await sharp(overlayBuffer)
    .extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight })
    .png()
    .toBuffer();

  if (options.mode === "source") {
    const clippedCoverage =
      coverage === undefined
        ? undefined
        : cropCoverage(coverage.data, coverage.width, cropLeft, cropTop, visibleWidth, visibleHeight);
    return sourceRegion(input, clipped, left, top, clippedCoverage);
  }

  return sharp(input)
    .composite([{ input: clipped, left, top }])
    .png()
    .toBuffer();
}

async function overlaySource(
  source: Image | MaskedImage
): Promise<{ image: Buffer; mask?: Buffer; channel?: "alpha" | "luminance" }> {
  if (source instanceof Image) {
    return { image: await source.toBuffer({ format: "png" }) };
  }

  if (source instanceof AttachedMask) {
    return {
      image: await source.state.image.toBuffer({ format: "png" }),
      mask: await source.state.mask.toBuffer({ format: "png" }),
      channel: source.state.channel
    };
  }

  throw new Error("Invalid masked image.");
}

async function maskCoverage(
  mask: Buffer,
  channel: "alpha" | "luminance"
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await rawRgba(mask);
  const coverage = Buffer.alloc(info.width * info.height);

  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const offset = pixel * 4;
    if (channel === "alpha") {
      coverage[pixel] = data[offset + 3]!;
      continue;
    }

    const luminance = 0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!;
    coverage[pixel] = Math.round(luminance);
  }

  return { data: coverage, width: info.width, height: info.height };
}

async function applyCoverageToAlpha(input: Buffer, coverage: Buffer): Promise<Buffer> {
  const { data, info } = await rawRgba(input);
  const output = Buffer.from(data);

  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const alphaOffset = pixel * 4 + 3;
    output[alphaOffset] = Math.round((output[alphaOffset]! * coverage[pixel]!) / 255);
  }

  return rawToPng(output, info.width, info.height);
}

function cropCoverage(
  coverage: Buffer,
  width: number,
  left: number,
  top: number,
  cropWidth: number,
  cropHeight: number
): Buffer {
  const cropped = Buffer.alloc(cropWidth * cropHeight);

  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = (top + y) * width + left;
    coverage.copy(cropped, y * cropWidth, sourceStart, sourceStart + cropWidth);
  }

  return cropped;
}

async function sourceRegion(
  input: Buffer,
  source: Buffer,
  left: number,
  top: number,
  coverage?: Buffer
): Promise<Buffer> {
  const base = await rawRgba(input);
  const replacement = await rawRgba(source);
  const output = Buffer.from(base.data);

  for (let y = 0; y < replacement.info.height; y += 1) {
    for (let x = 0; x < replacement.info.width; x += 1) {
      const pixel = y * replacement.info.width + x;
      const sourceOffset = pixel * 4;
      const targetOffset = ((top + y) * base.info.width + left + x) * 4;
      const mask = coverage?.[pixel] ?? 255;

      if (mask === 0) {
        continue;
      }

      if (mask === 255) {
        output[targetOffset] = replacement.data[sourceOffset]!;
        output[targetOffset + 1] = replacement.data[sourceOffset + 1]!;
        output[targetOffset + 2] = replacement.data[sourceOffset + 2]!;
        output[targetOffset + 3] = replacement.data[sourceOffset + 3]!;
        continue;
      }

      interpolatePremultipliedPixel(output, targetOffset, replacement.data, sourceOffset, mask / 255);
    }
  }

  return rawToPng(output, base.info.width, base.info.height);
}

function interpolatePremultipliedPixel(
  destination: Buffer,
  destinationOffset: number,
  source: Buffer,
  sourceOffset: number,
  coverage: number
): void {
  const destinationAlpha = destination[destinationOffset + 3]!;
  const sourceAlpha = source[sourceOffset + 3]!;
  const outputAlpha = destinationAlpha * (1 - coverage) + sourceAlpha * coverage;

  for (let channel = 0; channel < 3; channel += 1) {
    const premultiplied =
      destination[destinationOffset + channel]! * (destinationAlpha / 255) * (1 - coverage) +
      source[sourceOffset + channel]! * (sourceAlpha / 255) * coverage;
    destination[destinationOffset + channel] = outputAlpha === 0 ? 0 : Math.round((premultiplied * 255) / outputAlpha);
  }

  destination[destinationOffset + 3] = Math.round(outputAlpha);
}

async function drawText(input: Buffer, options: TextOptions): Promise<Buffer> {
  if (options.value.length === 0) {
    return input;
  }

  const color = await colorToPango(options.color);
  if (color.alpha === 0) {
    return input;
  }

  const alpha = color.alpha === 65535 ? "" : ` alpha="${color.alpha}"`;
  const font = await fontToSharp(options.font, options.size);
  const weight = font.weight === undefined ? "" : ` weight="${escapeAttribute(String(font.weight))}"`;
  const text = `<span foreground="${color.foreground}"${alpha}${weight}>${escapeText(options.value)}</span>`;
  const textImage = await renderPangoText(text, font);
  const { width: textWidth } = await dimensions(textImage);
  const verticalAnchor = options.verticalAnchor ?? "baseline";

  let positionedImage = textImage;
  let top = options.y;

  if (verticalAnchor === "text-top") {
    positionedImage = await sharp(textImage)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } else {
    const strut = `<span alpha="1"${weight}>é</span>`;
    const strutImage = await renderPangoText(strut, font);
    const { height: ascent } = await dimensions(strutImage);
    const fontAlignedImage = await renderPangoText(text + strut, font);
    const { height } = await dimensions(fontAlignedImage);

    positionedImage = await sharp(fontAlignedImage)
      .extract({ left: 0, top: 0, width: textWidth, height })
      .png()
      .toBuffer();
    top = verticalAnchor === "baseline" ? options.y - ascent : options.y;
  }

  const { width } = await dimensions(positionedImage);
  const anchorOffset = options.anchor === "middle" ? width / 2 : options.anchor === "end" ? width : 0;

  return overlay(input, {
    image: Image.buffer({ buffer: positionedImage }),
    x: Math.round(options.x - anchorOffset),
    y: Math.round(top)
  });
}

async function renderPangoText(text: string, font: SharpFont): Promise<Buffer> {
  const textOptions = {
    text,
    font: font.description,
    rgba: true,
    ...(font.file === undefined ? {} : { fontfile: font.file })
  };

  return sharp({ text: textOptions })
    .png()
    .toBuffer();
}

async function drawSvgMarkup(input: Buffer, markup: string, fonts: readonly Font[] = []): Promise<Buffer> {
  await Promise.all(fonts.map(async (font) => {
    await renderPangoText("x", await fontToSharp(font, 12));
  }));

  const { width, height } = await dimensions(input);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${markup}</svg>`;
  return sharp(input)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

function lineSvg(options: LineOptions): string {
  return `<line x1="${options.x1}" y1="${options.y1}" x2="${options.x2}" y2="${options.y2}" stroke="${colorToSvg(options.color)}" stroke-width="${options.width ?? 1}" stroke-linecap="round" />`;
}

function rectSvg(options: RectOptions): string {
  const bounds = rectBounds(options);
  const fill = options.fill === undefined ? "none" : colorToSvg(options.fill);
  const stroke = options.stroke === undefined ? "none" : colorToSvg(options.stroke);
  const strokeWidth = options.strokeWidth ?? 0;
  const strokeBounds = rectStrokeBounds(bounds, strokeWidth, options.strokePosition ?? "center");
  const radius = options.radius ?? 0;
  const fillSvg =
    options.fill === undefined
      ? ""
      : `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="none" />`;
  const strokeSvg =
    options.stroke === undefined
      ? ""
      : `<rect x="${strokeBounds.x}" y="${strokeBounds.y}" width="${strokeBounds.width}" height="${strokeBounds.height}" rx="${radius}" ry="${radius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" />`;

  return fillSvg + strokeSvg;
}

function rectBounds(options: RectOptions): { x: number; y: number; width: number; height: number } {
  const x2 = endCoordinate("x", options.x, options.width, options.x2);
  const y2 = endCoordinate("y", options.y, options.height, options.y2);
  const x = Math.min(options.x, x2);
  const y = Math.min(options.y, y2);

  return {
    x,
    y,
    width: Math.abs(x2 - options.x),
    height: Math.abs(y2 - options.y)
  };
}

function endCoordinate(axis: "x" | "y", start: number, size: number | undefined, end: number | undefined): number {
  if (size === undefined && end === undefined) {
    throw new Error(`Rectangle requires ${axis === "x" ? "width or x2" : "height or y2"}.`);
  }

  if (size !== undefined && end !== undefined) {
    throw new Error(`Rectangle accepts either ${axis === "x" ? "width or x2" : "height or y2"}, not both.`);
  }

  return end ?? start + size!;
}

function rectStrokeBounds(
  bounds: { x: number; y: number; width: number; height: number },
  strokeWidth: number,
  strokePosition: "center" | "inside" | "outside"
): { x: number; y: number; width: number; height: number } {
  const offset = strokePosition === "inside" ? strokeWidth / 2 : strokePosition === "outside" ? -strokeWidth / 2 : 0;

  return {
    x: bounds.x + offset,
    y: bounds.y + offset,
    width: Math.max(0, bounds.width - offset * 2),
    height: Math.max(0, bounds.height - offset * 2)
  };
}

function circleSvg(options: CircleOptions): string {
  const fill = options.fill === undefined ? "none" : colorToSvg(options.fill);
  const stroke = options.stroke === undefined ? "none" : colorToSvg(options.stroke);
  const strokeWidth = options.strokeWidth ?? 0;

  return `<circle cx="${options.cx}" cy="${options.cy}" r="${options.r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
}


async function applyOpacity(input: Buffer, opacity: number): Promise<Buffer> {
  if (opacity < 0 || opacity > 1) {
    throw new Error("Opacity must be between 0 and 1.");
  }

  const { data, info } = await rawRgba(input);
  const output = Buffer.from(data);

  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.round(output[index] * opacity);
  }

  return rawToPng(output, info.width, info.height);
}

async function blankBuffer(width: number, height: number, color: Color): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: colorToSharp(color)
    }
  })
    .png()
    .toBuffer();
}

async function dimensions(input: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input).metadata();
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error("Unable to determine image dimensions.");
  }

  return { width: metadata.width, height: metadata.height };
}

function colorToSvg(color: Color): string {
  return escapeAttribute(colorToCss(color));
}

async function colorToPango(color: Color): Promise<{ foreground: string; alpha: number }> {
  const pixel = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: colorToSharp(color)
    }
  })
    .raw()
    .toBuffer();
  const foreground = `#${pixel[0]!.toString(16).padStart(2, "0")}${pixel[1]!.toString(16).padStart(2, "0")}${pixel[2]!.toString(16).padStart(2, "0")}`;

  return { foreground, alpha: pixel[3]! * 257 };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function rawRgba(input: Buffer): Promise<{ data: Buffer; info: { width: number; height: number } }> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, info: { width: info.width, height: info.height } };
}

async function rawToPng(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function pathFromFileOption(path: string | URL): string {
  return path instanceof URL ? fileURLToPath(path) : path;
}
