import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export interface SystemFontOptions {
  family: string;
  /** Default text size; per-call sizes take precedence. */
  size?: number;
  weight?: number | string;
  axes?: Readonly<Record<string, number>>;
}

export interface FileFontOptions {
  path: string | URL;
  /** Default text size; per-call sizes take precedence. */
  size?: number;
  family?: string;
  weight?: number | string;
  axes?: Readonly<Record<string, number>>;
}

export interface TextMeasurementOptions {
  value: string;
  /** Overrides the font's size. Required when the font has no size. */
  size?: number;
}

export interface TextMetrics {
  width: number;
  height: number;
  ascent: number;
  descent: number;
}

type FontValue =
  | {
      kind: "system";
      family: string;
      size?: number;
      weight?: number | string;
      axes?: readonly (readonly [string, number])[];
    }
  | {
      kind: "file";
      path: string;
      size?: number;
      family?: string;
      weight?: number | string;
      axes?: readonly (readonly [string, number])[];
    };

export interface SharpFont {
  description: string;
  weight?: number | string;
  file?: string;
}

const values = new WeakMap<Font, FontValue>();
const fileFamilyCache = new Map<string, Promise<string>>();

/** An immutable, reusable font selection. */
export class Font {
  private constructor(value: FontValue) {
    if (value.size !== undefined) {
      assertSize(value.size);
    }
    values.set(this, value);
    Object.freeze(this);
  }

  /** Selects a font installed on the system. */
  static system(options: SystemFontOptions): Font {
    assertFamily(options.family);
    const axes = normalizeAxes(options.axes);
    return new Font({
      kind: "system",
      family: options.family,
      ...(options.size === undefined ? {} : { size: options.size }),
      ...(options.weight === undefined ? {} : { weight: options.weight }),
      ...(axes === undefined ? {} : { axes })
    });
  }

  /** Selects a font from a TTF or OTF file. Its embedded family name is used by default. */
  static file(options: FileFontOptions): Font {
    if (options.family !== undefined) {
      assertFamily(options.family);
    }

    const path = options.path instanceof URL ? fileURLToPath(options.path) : options.path;
    if (path.length === 0) {
      throw new Error("Font file path must not be empty.");
    }

    const axes = normalizeAxes(options.axes);
    return new Font({
      kind: "file",
      path,
      ...(options.size === undefined ? {} : { size: options.size }),
      ...(options.family === undefined ? {} : { family: options.family }),
      ...(options.weight === undefined ? {} : { weight: options.weight }),
      ...(axes === undefined ? {} : { axes })
    });
  }

  /** Measures text using the same Pango font metrics as Image.drawText(). */
  async measureText(options: TextMeasurementOptions): Promise<TextMetrics> {
    const font = await fontToSharp(this, options.size);
    const weight = font.weight === undefined ? "" : ` weight="${escapeAttribute(String(font.weight))}"`;
    const strut = await renderText(`<span alpha="1"${weight}>é</span>`, font);
    const strutMetadata = await sharp(strut).metadata();
    const ascent = requiredDimension(strutMetadata.height);

    if (options.value.length === 0) {
      return { width: 0, height: ascent, ascent, descent: 0 };
    }

    const text = `<span${weight}>${escapeText(options.value)}</span>`;
    const rendered = await renderText(text, font);
    const aligned = await renderText(text + `<span alpha="1"${weight}>é</span>`, font);
    const renderedMetadata = await sharp(rendered).metadata();
    const alignedMetadata = await sharp(aligned).metadata();
    const height = requiredDimension(alignedMetadata.height);

    return {
      width: requiredDimension(renderedMetadata.width),
      height,
      ascent,
      descent: Math.max(0, height - ascent)
    };
  }
}

export async function fontToSharp(font: Font | undefined, size?: number): Promise<SharpFont> {
  const value = font === undefined ? undefined : values.get(font);
  if (font !== undefined && value === undefined) {
    throw new Error("Invalid Font value.");
  }

  const resolvedSize = size ?? value?.size;
  if (resolvedSize === undefined) {
    throw new Error("Font size is required. Pass size to the Font or the text options.");
  }
  assertSize(resolvedSize);

  if (value === undefined) {
    return { description: `sans ${resolvedSize}` };
  }

  const family = value.kind === "file" && value.family === undefined
    ? await familyFromFile(value.path)
    : value.family;
  const variations = value.axes === undefined
    ? ""
    : ` @${value.axes.map(([axis, setting]) => `${axis}=${setting}`).join(",")}`;
  const result: SharpFont = {
    description: `${family} ${resolvedSize}${variations}`
  };

  if (value.weight !== undefined) {
    result.weight = value.weight;
  }

  if (value.kind === "file") {
    result.file = value.path;
  }

  return result;
}

async function familyFromFile(path: string): Promise<string> {
  let cached = fileFamilyCache.get(path);
  if (cached === undefined) {
    cached = readFontFamily(path);
    fileFamilyCache.set(path, cached);
  }
  return cached;
}

async function readFontFamily(path: string): Promise<string> {
  const data = await readFile(path);
  const family = sfntFamily(data);
  if (family === undefined) {
    throw new Error(
      `Unable to extract a font family from ${path}. Pass family explicitly to Font.file() for unsupported font formats.`
    );
  }
  return family;
}

function sfntFamily(data: Buffer): string | undefined {
  if (data.length < 12) {
    return undefined;
  }

  const signature = data.toString("latin1", 0, 4);
  if (signature !== "\u0000\u0001\u0000\u0000" && signature !== "OTTO" && signature !== "true") {
    return undefined;
  }

  const tableCount = data.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > data.length) {
      return undefined;
    }

    if (data.toString("ascii", recordOffset, recordOffset + 4) !== "name") {
      continue;
    }

    const offset = data.readUInt32BE(recordOffset + 8);
    const length = data.readUInt32BE(recordOffset + 12);
    if (offset + length > data.length) {
      return undefined;
    }

    return nameTableFamily(data.subarray(offset, offset + length));
  }

  return undefined;
}

function nameTableFamily(table: Buffer): string | undefined {
  if (table.length < 6) {
    return undefined;
  }

  const recordCount = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  let best: { value: string; score: number } | undefined;

  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = 6 + index * 12;
    if (recordOffset + 12 > table.length) {
      return undefined;
    }

    const platform = table.readUInt16BE(recordOffset);
    const language = table.readUInt16BE(recordOffset + 4);
    const nameId = table.readUInt16BE(recordOffset + 6);
    if (nameId !== 1 && nameId !== 16) {
      continue;
    }

    const length = table.readUInt16BE(recordOffset + 8);
    const offset = stringOffset + table.readUInt16BE(recordOffset + 10);
    if (offset + length > table.length) {
      continue;
    }

    const value = decodeName(table.subarray(offset, offset + length), platform).trim();
    if (value.length === 0) {
      continue;
    }

    const score = (nameId === 16 ? 100 : 0) + platformScore(platform, language);
    if (best === undefined || score > best.score) {
      best = { value, score };
    }
  }

  return best?.value;
}

function decodeName(data: Buffer, platform: number): string {
  if (platform !== 0 && platform !== 3) {
    return data.toString("latin1").replaceAll("\u0000", "");
  }

  const evenLength = data.length - (data.length % 2);
  const littleEndian = Buffer.alloc(evenLength);
  for (let offset = 0; offset < evenLength; offset += 2) {
    littleEndian[offset] = data[offset + 1]!;
    littleEndian[offset + 1] = data[offset]!;
  }
  return littleEndian.toString("utf16le").replaceAll("\u0000", "");
}

function platformScore(platform: number, language: number): number {
  if (platform === 3) {
    return language === 0x0409 ? 50 : 30;
  }
  if (platform === 0) {
    return 40;
  }
  if (platform === 1) {
    return 20;
  }
  return 0;
}

function normalizeAxes(axes: Readonly<Record<string, number>> | undefined): readonly (readonly [string, number])[] | undefined {
  if (axes === undefined) {
    return undefined;
  }

  const entries = Object.entries(axes).map(([axis, setting]) => {
    if (!/^[A-Za-z0-9]{4}$/.test(axis)) {
      throw new Error(`Font axis must be a four-character OpenType tag: ${axis}.`);
    }
    if (!Number.isFinite(setting)) {
      throw new Error(`Font axis ${axis} must have a finite numeric value.`);
    }
    return Object.freeze([axis, setting] as const);
  });

  return entries.length === 0 ? undefined : Object.freeze(entries);
}

function assertSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Font size must be positive and finite.");
  }
}

function assertFamily(family: string): void {
  if (family.length === 0) {
    throw new Error("Font family must not be empty.");
  }
}

async function renderText(text: string, font: SharpFont): Promise<Buffer> {
  return sharp({
    text: {
      text,
      font: font.description,
      rgba: true,
      ...(font.file === undefined ? {} : { fontfile: font.file })
    }
  })
    .png()
    .toBuffer();
}

function requiredDimension(value: number | undefined): number {
  if (value === undefined) {
    throw new Error("Unable to determine text dimensions.");
  }
  return value;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
