import { Buffer } from "node:buffer";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Image } from "../../src/index.js";

export type ImageInput = Image | Buffer | Uint8Array | string | URL;

export interface ImageMatchOptions {
  artifactsDir?: string | URL;
  maxChannelDelta?: number;
  maxMismatchedPixels?: number;
}

interface RawRgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function expectImageToMatchReference(
  actual: ImageInput,
  expected: ImageInput,
  options: ImageMatchOptions = {}
): Promise<void> {
  const maxChannelDelta = options.maxChannelDelta ?? 0;
  const maxMismatchedPixels = options.maxMismatchedPixels ?? 0;
  const actualPng = await toPngBuffer(actual);
  const expectedPath = pathFromFileReference(expected);

  if (expectedPath !== undefined) {
    const approvedActualPath = approvedActualReferencePath(expectedPath);
    if (await exists(approvedActualPath)) {
      await rm(expectedPath, { force: true });
      await rename(approvedActualPath, expectedPath);
    }
  }

  if (expectedPath !== undefined && !(await exists(expectedPath))) {
    const actualPath = await writeActualArtifact(expectedPath, actualPng, options.artifactsDir);
    throw new Error(`Missing reference image at ${expectedPath}. Wrote candidate actual image to ${actualPath}.`);
  }

  const actualRaw = await toRawRgba(actualPng);
  const expectedRaw = await toRawRgba(expected);

  if (actualRaw.width !== expectedRaw.width || actualRaw.height !== expectedRaw.height) {
    if (expectedPath !== undefined) {
      await writeDimensionMismatchArtifacts(expectedPath, actualPng, options.artifactsDir);
    }

    throw new Error(
      `Image dimensions differ from reference: expected ${expectedRaw.width}x${expectedRaw.height} but got ${actualRaw.width}x${actualRaw.height}.`
    );
  }

  let mismatchedPixels = 0;
  let firstMismatch: string | undefined;

  for (let offset = 0; offset < actualRaw.data.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % actualRaw.width;
    const y = Math.floor(pixel / actualRaw.width);
    const actualPixel = Array.from(actualRaw.data.subarray(offset, offset + 4));
    const expectedPixel = Array.from(expectedRaw.data.subarray(offset, offset + 4));
    const matches = actualPixel.every((channel, index) => Math.abs(channel - expectedPixel[index]!) <= maxChannelDelta);

    if (!matches) {
      mismatchedPixels += 1;
      firstMismatch ??= `first mismatch at (${x}, ${y}): expected ${expectedPixel.join(",")} but got ${actualPixel.join(",")}`;
    }
  }

  if (mismatchedPixels > maxMismatchedPixels) {
    if (expectedPath !== undefined) {
      await writeMismatchArtifacts(expectedPath, actualPng, actualRaw, expectedRaw, maxChannelDelta, options.artifactsDir);
    }

    throw new Error(
      `Image differs from reference in ${mismatchedPixels} pixels; allowed ${maxMismatchedPixels}. ${firstMismatch ?? ""}`
    );
  }
}

export async function rgbaReference(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number]
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixel(x, y);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function toRawRgba(image: ImageInput): Promise<RawRgbaImage> {
  const input = await toSharpInput(image);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height
  };
}

async function toPngBuffer(image: ImageInput): Promise<Buffer> {
  return sharp(await toSharpInput(image))
    .png()
    .toBuffer();
}

async function toSharpInput(image: ImageInput): Promise<Buffer | string> {
  if (image instanceof Image) {
    return image.toBuffer({ format: "png" });
  }

  if (image instanceof URL) {
    return fileURLToPath(image);
  }

  if (typeof image === "string" || Buffer.isBuffer(image)) {
    return image;
  }

  return Buffer.from(image);
}

function pathFromFileReference(image: ImageInput): string | undefined {
  if (image instanceof URL) {
    return fileURLToPath(image);
  }

  return typeof image === "string" ? image : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await sharp(path).metadata();
    return true;
  } catch {
    return false;
  }
}

async function writeMismatchArtifacts(
  expectedPath: string,
  actualPng: Buffer,
  actualRaw: RawRgbaImage,
  expectedRaw: RawRgbaImage,
  maxChannelDelta: number,
  artifactsDir?: string | URL
): Promise<void> {
  const dir = outputDir(artifactsDir);
  const name = expectedPath
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "");
  const actualPath = join(dir, `${name}.actual.png`);
  const expectedCopyPath = join(dir, `${name}.expected.png`);
  const diffPath = join(dir, `${name}.diff.png`);

  await mkdir(dir, { recursive: true });
  await writeFile(actualPath, actualPng);
  await writeFile(expectedCopyPath, await toPngBuffer(expectedPath));
  await writeFile(diffPath, await diffPng(actualRaw, expectedRaw, maxChannelDelta));
}

async function writeDimensionMismatchArtifacts(
  expectedPath: string,
  actualPng: Buffer,
  artifactsDir?: string | URL
): Promise<void> {
  const dir = outputDir(artifactsDir);
  const name = artifactName(expectedPath);
  const actualPath = join(dir, `${name}.actual.png`);
  const expectedCopyPath = join(dir, `${name}.expected.png`);

  await mkdir(dir, { recursive: true });
  await writeFile(actualPath, actualPng);
  await writeFile(expectedCopyPath, await toPngBuffer(expectedPath));
}

async function writeActualArtifact(expectedPath: string, actualPng: Buffer, artifactsDir?: string | URL): Promise<string> {
  const dir = outputDir(artifactsDir);
  const name = artifactName(expectedPath);
  const actualPath = join(dir, `${name}.actual.png`);

  await mkdir(dir, { recursive: true });
  await writeFile(actualPath, actualPng);

  return actualPath;
}

function pathFromArtifactDir(path: string | URL): string {
  return path instanceof URL ? fileURLToPath(path) : path;
}

function outputDir(artifactsDir: string | URL | undefined): string {
  return artifactsDir === undefined ? join(cwd(), "tests", "output") : pathFromArtifactDir(artifactsDir);
}

function artifactName(expectedPath: string): string {
  return expectedPath
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "");
}

function approvedActualReferencePath(expectedPath: string): string {
  const path = parse(expectedPath);
  return join(path.dir, `${path.name}.actual${path.ext}`);
}

async function diffPng(actual: RawRgbaImage, expected: RawRgbaImage, maxChannelDelta: number): Promise<Buffer> {
  const data = Buffer.alloc(actual.width * actual.height * 4);

  for (let offset = 0; offset < data.length; offset += 4) {
    const matches =
      Math.abs(actual.data[offset]! - expected.data[offset]!) <= maxChannelDelta &&
      Math.abs(actual.data[offset + 1]! - expected.data[offset + 1]!) <= maxChannelDelta &&
      Math.abs(actual.data[offset + 2]! - expected.data[offset + 2]!) <= maxChannelDelta &&
      Math.abs(actual.data[offset + 3]! - expected.data[offset + 3]!) <= maxChannelDelta;

    if (matches) {
      data[offset] = actual.data[offset]!;
      data[offset + 1] = actual.data[offset + 1]!;
      data[offset + 2] = actual.data[offset + 2]!;
      data[offset + 3] = 64;
    } else {
      data[offset] = 255;
      data[offset + 1] = 0;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }

  return sharp(data, { raw: { width: actual.width, height: actual.height, channels: 4 } })
    .png()
    .toBuffer();
}
