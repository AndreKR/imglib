import { describe, expect, test } from "vitest";
import { Color, Font, Image } from "../src/index.js";

describe("Fonts", () => {
  test("Empty system font families are rejected", () => {
    expect(() => Font.system({ family: "" })).toThrow("Font family must not be empty.");
  });

  test("Empty file font families are rejected", () => {
    expect(() => Font.file({ path: "font.ttf", family: "" })).toThrow("Font family must not be empty.");
  });

  test("Empty font file paths are rejected", () => {
    expect(() => Font.file({ path: "", family: "Example" })).toThrow("Font file path must not be empty.");
  });

  test("Invalid variation axes are rejected", () => {
    expect(() => Font.system({ family: "Example", axes: { weight: 500 } })).toThrow(
      "Font axis must be a four-character OpenType tag: weight."
    );
    expect(() => Font.system({ family: "Example", axes: { wght: Number.NaN } })).toThrow(
      "Font axis wght must have a finite numeric value."
    );
  });

  test("Text measurement reports dimensions and baseline metrics", async () => {
    const font = Font.file({
      path: new URL("./images/InterVariable.ttf", import.meta.url),
      axes: { wght: 400 },
    });
    const metrics = await font.measureText({ value: "Égyp", size: 28 });

    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.ascent).toBeGreaterThan(0);
    expect(metrics.descent).toBeGreaterThan(0);
    expect(metrics.height).toBe(metrics.ascent + metrics.descent);
  });

  test("Font sizes must be positive and finite", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Font.system({ family: "sans", size })).toThrow(
        "Font size must be positive and finite."
      );
      expect(() => Font.file({ path: "font.ttf", size })).toThrow(
        "Font size must be positive and finite."
      );
    }
  });

  test("Text measurement uses the font size unless overridden", async () => {
    const path = new URL("./images/InterVariable.ttf", import.meta.url);
    for (const font of [Font.system({ family: "sans", size: 28 }), Font.file({ path, size: 28 })]) {
      const original = await font.measureText({ value: "Égyp" });
      expect(original).toEqual(await font.measureText({ value: "Égyp", size: 28 }));
      const overridden = await font.measureText({ value: "Égyp", size: 14 });
      expect(overridden.width).toBeLessThan(original.width);
      expect(await font.measureText({ value: "Égyp" })).toEqual(original);
      expect(Object.isFrozen(font)).toBe(true);
    }
  });

  test("Text rendering uses the font size unless overridden", async () => {
    const path = new URL("./images/InterVariable.ttf", import.meta.url);
    const base = Image.blank({ width: 200, height: 100 });
    const text = { value: "Égyp", x: 10, y: 50, color: Color.rgb(0, 0, 0) };
    for (const font of [Font.system({ family: "sans", size: 28 }), Font.file({ path, size: 28 })]) {
      const inherited = await base.drawText({ ...text, font }).toBuffer({ format: "png" });
      const explicit = await base.drawText({ ...text, font, size: 28 }).toBuffer({ format: "png" });
      expect(inherited).toEqual(explicit);

      const overridden = await base.drawText({ ...text, font, size: 14 }).toBuffer({ format: "png" });

      expect(overridden).not.toEqual(inherited);
      expect(await base.drawText({ ...text, font }).toBuffer({ format: "png" })).toEqual(inherited);
    }
  });

  test("Text requires a size from the font or the call", async () => {
    const font = Font.system({ family: "sans" });
    await expect(font.measureText({ value: "Hello" })).rejects.toThrow(
      "Font size is required. Pass size to the Font or the text options."
    );
    for (const options of [{}, { font }]) {
      const image = Image.blank({ width: 100, height: 50 }).drawText({
        value: "Hello", x: 0, y: 25, color: Color.rgb(0, 0, 0), ...options,
      });
      await expect(image.toBuffer({ format: "png" })).rejects.toThrow(
        "Font size is required. Pass size to the Font or the text options."
      );
    }
  });

  test("Invalid per-call sizes do not fall back to the font size", async () => {
    const font = Font.system({ family: "sans", size: 28 });
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(font.measureText({ value: "Hello", size })).rejects.toThrow(
        "Font size must be positive and finite."
      );
      const image = Image.blank({ width: 100, height: 50 }).drawText({
        value: "Hello", x: 0, y: 25, color: Color.rgb(0, 0, 0), font, size,
      });
      await expect(image.toBuffer({ format: "png" })).rejects.toThrow(
        "Font size must be positive and finite."
      );
    }
  });

  test("Unsupported files require an explicit family override", async () => {
    const image = Image.blank({ width: 10, height: 10 }).drawText({
      value: "x",
      x: 0,
      y: 5,
      size: 5,
      color: Color.css({ value: "black" }),
      font: Font.file({ path: new URL("./images/small.png", import.meta.url) }),
    });

    await expect(image.toBuffer({ format: "png" })).rejects.toThrow(
      "Pass family explicitly to Font.file() for unsupported font formats."
    );
  });
});
