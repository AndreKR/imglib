import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { Color, Font, Image } from "../src/index.js";
import { expectImageToMatchReference, rgbaReference } from "./helpers/imageAssertions.js";

describe("Ordered Operations", () => {
  test("Resize then crop is executed in the requested order", async () => {
    const image = Image.file({ path: imageFile("photo.png") })
      .resize({ width: 250 })
      .crop({ x: 50, y: 50, width: 150, height: 150 });

    await expectImageToMatchReference(image, reference("ordered-operations-resize-then-crop.png"));
  });

  test("Crop then resize is executed in the requested order", async () => {
    const image = Image.file({ path: imageFile("photo.png") })
      .crop({ x: 100, y: 100, width: 300, height: 300 })
      .resize({ width: 250 });

    await expectImageToMatchReference(image, reference("ordered-operations-crop-then-resize.png"));
  });

});

describe("Output", () => {
  test("Buffer format is selected explicitly", async () => {
    const image = Image.blank({
      width: 2,
      height: 2,
      color: Color.css({ value: "red" }),
    });
    const png = await image.toBuffer({ format: "png", compressionLevel: 0 });
    const jpeg = await image.toBuffer({
      format: "jpeg",
      quality: 100,
      chromaSubsampling: "4:4:4",
    });

    expect((await sharp(png).metadata()).format).toBe("png");
    expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
  });

  test("Save format does not depend on the file extension", async () => {
    const outputDirectory = new URL("./output/", import.meta.url);
    const path = new URL("jpeg-with-png-extension.png", outputDirectory);
    await mkdir(fileURLToPath(outputDirectory), { recursive: true });

    try {
      await Image.blank({
        width: 2,
        height: 2,
        color: Color.css({ value: "red" }),
      }).save({
        path,
        format: "jpeg",
        quality: 100,
        chromaSubsampling: "4:4:4",
      });

      expect((await sharp(fileURLToPath(path)).metadata()).format).toBe("jpeg");
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("Compositing", () => {
  test("Overlays can extend beyond the base image", async () => {
    const base = Image.file({ path: imageFile("photo.png") });
    const overlay = Image.file({ path: imageFile("yarn-kitten-300.png") });
    const output = base.overlay({ image: overlay, x: -50, y: 20 });

    await expectImageToMatchReference(output, reference("compositing-overlay-clipped.png"));
  });

  test("Overlay transparency is applied over an existing image", async () => {
    const image = Image.file({ path: imageFile("photo.png") }).overlay({
      image: Image.file({ path: imageFile("matrix.png") }),
      x: 120,
      y: 30,
    });

    await expectImageToMatchReference(
      image,
      reference("compositing-overlay-matrix-over.png"),
    );
  });

  test("Overlay source pixels can replace an existing image region", async () => {
    const image = Image.file({ path: imageFile("photo.png") }).overlay({
      image: Image.file({ path: imageFile("matrix.png") }),
      x: 120,
      y: 30,
      mode: "source",
    });

    await expectImageToMatchReference(
      image,
      reference("compositing-overlay-matrix-source.png"),
    );
  });
});

describe("Masking", () => {
  test("blankLike() creates a transparent image of same dimensions", async () => {
    const source = Image.buffer({
      buffer: await rgbaReference(3, 2, () => [20, 40, 60, 255]),
    });
    const blank = Image.blankLike({ image: source });
    const expected = await rgbaReference(3, 2, () => [0, 0, 0, 0]);

    await expectImageToMatchReference(blank, expected);
  });

  test("Applying a transformation to part of an image", async () => {
    const base = Image.file({ path: imageFile("photo.png") });

    const transformed = base.invert();

    const mask = Image.blankLike({ image: transformed })
      .drawRect({
        x: 50,
        y: 100,
        width: 400,
        height: 300,
        fill: Color.opaque,
      });

    const result = base.overlay({
      image: transformed.attachMask({ mask }),
      x: 0,
      y: 0,
    });

    await expectImageToMatchReference(
      result,
      reference("masking-transform-image-part.png"),
    );
  });

  test("Mask uses alpha, not color", async () => {

    const base = Image.file({ path: imageFile("photo.png") });
    const overlay = Image.file({ path: imageFile("yarn-kitten-300.png") });

    const mask = Image.blankLike({ image: overlay })
      .drawRect({
        x: 10,
        y: 10,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 0, 0, 1),
      })
      .drawRect({
        x: 160,
        y: 10,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 128, 255, 1),
      })
      .drawRect({
        x: 10,
        y: 160,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 0, 0, 0.3),
      })
      .drawRect({
        x: 160,
        y: 160,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 128, 255, 0.3),
      });

    const result = base.overlay({
      image: overlay.attachMask({ mask }),
      x: 100,
      y: 100,
    });

    await expectImageToMatchReference(
      result,
      reference("masking-alpha-and-color.png"),
    );
  });

  test("Masks are clipped together with overlays", async () => {

    const base = Image.file({ path: imageFile("photo.png") });
    const overlay = Image.file({ path: imageFile("yarn-kitten-300.png") });

    const mask = Image.blankLike({ image: overlay })
      .drawCircle({
        cx: 150,
        cy: 150,
        r: 150,
        fill: Color.opaque,
      });

    const output = base.overlay({ image: overlay.attachMask({ mask }), x: -50, y: 20 });

    await expectImageToMatchReference(
      output,
      reference("masking-overlay-clipped.png"),
    );
  });

  test("Luminance mask uses color, not alpha", async () => {

    const base = Image.file({ path: imageFile("photo.png") });
    const overlay = Image.file({ path: imageFile("yarn-kitten-300.png") });

    const mask = Image.blankLike({ image: overlay })
      .drawRect({
        x: 10,
        y: 10,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 0, 0, 1),
      })
      .drawRect({
        x: 160,
        y: 10,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 128, 255, 1),
      })
      .drawRect({
        x: 10,
        y: 160,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 0, 0, 0.3),
      })
      .drawRect({
        x: 160,
        y: 160,
        width: 130,
        height: 130,
        fill: Color.rgb(255, 128, 255, 0.3),
      });

    const result = base.overlay({
      image: overlay.attachMask({ mask, channel: "luminance" }),
      x: 100,
      y: 100,
    });

    await expectImageToMatchReference(
      result,
      reference("masking-color-and-alpha.png"),
    );
  });

  test("Mask dimensions must match the attached image", async () => {
    const base = Image.file({ path: imageFile("yarn-kitten-300.png") });
    const overlay = Image.file({ path: imageFile("small.png") });
    const mask = Image.blank({
      width: 1,
      height: 1,
    });
    const result = base.overlay({
      image: overlay.attachMask({ mask }),
      x: 0,
      y: 0,
    });

    await expect(result.toBuffer({ format: "png" })).rejects.toThrow(
      "Mask dimensions must match the masked image: image is 100x100, mask is 1x1."
    );
  });

  test("Discarding a mask returns the underlying image", async () => {
    const image = Image.file({ path: imageFile("small.png") });
    const mask = Image.blankLike({ image })
      .drawRect({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
        fill: Color.opaque,
      });

    const masked = image.attachMask({ mask });

    await expectImageToMatchReference(
      masked.discardMask(),
      reference("masking-discarded.png"),
    );
  });
});

describe("Image Operations", () => {
  test("Threshold with midpoint default", async () => {
    const image = Image.file({ path: imageFile("matrix.png") });
    const thresholded = image
      .thresholdLuminance()
      .thresholdAlpha();

    await expectImageToMatchReference(
      thresholded,
      reference("color-operations-threshold.png"),
    );
  });

  test("Threshold with custom value", async () => {
    const image = Image.file({ path: imageFile("matrix.png") });
    const thresholded = image
      .thresholdLuminance({ threshold: 0.2 })
      .thresholdAlpha({ threshold: 0.2 });

    await expectImageToMatchReference(
      thresholded,
      reference("color-operations-threshold-custom.png"),
    );
  });

  test("Threshold with invalid value", async () => {
    const image = Image.blank({ width: 1, height: 1 }).thresholdChannels({ threshold: 1.1 });

    await expect(image.toBuffer({ format: "png" })).rejects.toThrow("Threshold must be a finite number between 0 and 1.");
  });

  test("Nearest-neighbor resize preserves hard pixel edges", async () => {
    const image = Image.file({ path: imageFile("yarn-kitten-300.png") })
      .crop({ x: 40, y: 40, width: 10, height: 10 })
      .resize({ width: 200, kernel: "nearest" });

    await expectImageToMatchReference(image, reference("image-operations-nearest-neighbor.png"));
  });

  test("Midtone adjustment darkens without changing endpoints or alpha", async () => {
    const image = Image.file({ path: imageFile("matrix.png") })
      .adjustMidtones({ factor: 0.6 });

    await expectImageToMatchReference(image, reference("image-operations-midtones-down.png"));
  });

  test("Midtone adjustment brightens", async () => {
    const image = Image.file({ path: imageFile("small.png") })
      .adjustMidtones({ factor: 1.4 });

    await expectImageToMatchReference(image, reference("image-operations-midtones-up.png"));
  });

  test("Neutral midtone adjustment leaves the image unchanged", async () => {
    const image = Image.file({ path: imageFile("small.png") })
      .adjustMidtones({ factor: 1 });

    await expectImageToMatchReference(image, reference("image-operations-midtones-nop.png"));
  });

  test("Midtone adjustment rejects invalid factors", async () => {
    const image = Image.blank({ width: 1, height: 1 }).adjustMidtones({ factor: 0 });

    await expect(image.toBuffer({ format: "png" })).rejects.toThrow(
      "Midtone factor must be a positive finite number."
    );
  });

  test("Luminance threshold", async () => {
    const image = Image.file({ path: imageFile("matrix.png") });
    const thresholded = image.thresholdLuminance();

    await expectImageToMatchReference(
      thresholded,
      reference("color-operations-threshold-luminance.png"),
    );
  });

  test("Channel threshold", async () => {
    const image = Image.file({ path: imageFile("small.png") });
    const thresholded = image.thresholdChannels();

    await expectImageToMatchReference(
      thresholded,
      reference("color-operations-threshold-channels.png"),
    );
  });

  test("Alpha threshold", async () => {
    const image = Image.file({ path: imageFile("matrix.png") });
    const thresholded = image.thresholdAlpha();

    await expectImageToMatchReference(
      thresholded,
      reference("color-operations-threshold-alpha.png"),
    );
  });

});

describe("Drawing", () => {
  test("Outlined and filled rectangles drawn on a transparent background", async () => {
    const image = Image.blank({ width: 200, height: 50 })
      .drawRect({
        x: 10,
        y: 10,
        width: 80,
        height: 30,
        stroke: Color.css({ value: "red" }),
        strokeWidth: 4,
      })
      .drawRect({
        x: 110,
        y: 10,
        width: 80,
        height: 30,
        fill: Color.rgb(0, 120, 255, 0.75),
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-rectangles-transparent.png"),
    );
  });

  test("Outlined and filled rectangles drawn on an existing image", async () => {
    const image = Image.file({ path: imageFile("photo.png") })
      .resize({ width: 200, height: 50, mode: "cover" })
      .drawRect({
        x: 10,
        y: 10,
        width: 80,
        height: 30,
        stroke: Color.css({ value: "red" }),
        strokeWidth: 4,
      })
      .drawRect({
        x: 110,
        y: 10,
        width: 80,
        height: 30,
        fill: Color.rgb(0, 120, 255, 0.75),
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-rectangles-existing-image.png"),
    );
  });

  test("Rectangles can be drawn with second corner coordinates", async () => {
    const image = Image.blank({ width: 200, height: 50 })
      .drawRect({
        x: 10,
        y: 10,
        x2: 90,
        y2: 40,
        stroke: Color.css({ value: "red" }),
        strokeWidth: 4,
      })
      .drawRect({
        x: 110,
        y: 10,
        x2: 190,
        y2: 40,
        fill: Color.rgb(0, 120, 255, 0.75),
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-rectangles-second-corner.png"),
    );
  });

  test("Rectangles can be drawn with a reversed second corner", async () => {
    const image = Image.blank({ width: 200, height: 50 })
      .drawRect({
        x: 90,
        y: 40,
        x2: 10,
        y2: 10,
        stroke: Color.css({ value: "red" }),
        strokeWidth: 4,
      })
      .drawRect({
        x: 190,
        y: 10,
        x2: 110,
        y2: 40,
        fill: Color.rgb(0, 120, 255, 0.75),
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-rectangles-reversed-second-corner.png"),
    );
  });

  test("Rectangle strokes can be aligned inside and outside", async () => {
    const image = Image.blank({ width: 180, height: 90 })
      .drawRect({
        x: 22,
        y: 22,
        width: 50,
        height: 44,
        stroke: Color.css({ value: "red" }),
        strokeWidth: 12,
        strokePosition: "inside",
      })
      .drawRect({
        x: 108,
        y: 22,
        width: 50,
        height: 44,
        stroke: Color.css({ value: "blue" }),
        strokeWidth: 12,
        strokePosition: "outside",
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-rectangles-stroke-position.png"),
    );
  });

  test("Lines, circles, and rectangles", async () => {
    const image = Image.blank({
      width: 500,
      height: 500,
      color: Color.css({ value: "transparent" }),
    })
      .resize({ width: 320, height: 320, mode: "cover" })
      .drawLine({
        x1: 20,
        y1: 28,
        x2: 300,
        y2: 76,
        color: Color.css({ value: "white" }),
        width: 2,
      })
      .drawLine({
        x1: 24,
        y1: 294,
        x2: 294,
        y2: 216,
        color: Color.css({ value: "black" }),
        width: 12,
      })
      .drawCircle({
        cx: 92,
        cy: 176,
        r: 44,
        stroke: Color.css({ value: "cyan" }),
        strokeWidth: 5,
      })
      .drawCircle({
        cx: 226,
        cy: 106,
        r: 38,
        fill: Color.rgb(255, 220, 0, 0.7),
      })
      .drawRect({
        x: 178,
        y: 186,
        width: 96,
        height: 66,
        stroke: Color.css({ value: "lime" }),
        strokeWidth: 4,
      })
      .drawRect({
        x: 40,
        y: 42,
        width: 70,
        height: 46,
        fill: Color.rgb(255, 60, 0, 0.7),
      });

    await expectImageToMatchReference(
      image,
      reference("drawing-primitives.png"),
    );
  });
});

describe("Text", () => {
  test("Basic text rendering", async () => {
    const image = Image.blank({ width: 300, height: 100 })
      .drawCircle({
        cx: 20,
        cy: 50,
        r: 3,
        fill: Color.css({ value: "black" }),
      })
      .drawText({
        value: ">^..^< Hello Image >^..^<",
        x: 20,
        y: 50,
        size: 12,
        color: Color.rgb(0, 0, 0, 1),
        font: Font.file({
          path: imageFile("InterVariable.ttf"),
          axes: { wght: 700 },
        }),
      });

    await expectImageToMatchReference(image, reference("text-text-rendering.png"), {
      maxChannelDelta: 1,
    });
  });

  test("Text rendering with SVG", async () => {
    const inter = Font.file({
      path: imageFile("InterVariable.ttf"),
      family: "Inter",
      axes: { wght: 700 },
    });
    const image = Image.blank({ width: 300, height: 100 })
      .drawCircle({
        cx: 20,
        cy: 50,
        r: 3,
        fill: Color.css({ value: "black" }),
      })
      .drawSvgMarkup({
        markup: `<text x="20" y="50" font-family="Inter" font-size="12" font-weight="700" fill="black">>^..^&lt; Hello Image >^..^&lt; </text>`,
        fonts: [inter],
      });

    await expectImageToMatchReference(image, reference("text-svg-rendering.png"), {
      maxChannelDelta: 1,
    });
  });

  test("Text rendering at the edges", async () => {
    const image = Image.blank({ width: 200, height: 100 })
      .drawText({
        value: "Loremlorem",
        x: -20,
        y: 50,
        size: 12,
        color: Color.rgb(0, 0, 0, 1),
        font: Font.file({
          path: imageFile("InterVariable.ttf"),
          axes: { wght: 700 },
        }),
      })
      .drawText({
        value: "Ipsumipsum",
        x: 180,
        y: 50,
        size: 12,
        color: Color.rgb(0, 0, 0, 1),
        font: Font.file({
          path: imageFile("InterVariable.ttf"),
          axes: { wght: 700 },
        }),
      });

    await expectImageToMatchReference(image, reference("text-edge-rendering.png"), {
      maxChannelDelta: 1,
    });
  });

  test("Vertical text anchors position text relative to y", async () => {
    const black = Color.css({ value: "black" });
    const guide = Color.css({ value: "red" });
    const common = {
      size: 28,
      color: black,
      font: Font.file({
        path: imageFile("InterVariable.ttf"),
        axes: { wght: 400 },
      }),
    } as const;

    const image = Image.blank({
      width: 300,
      height: 150,
      color: Color.css({ value: "white" }),
    })
      .drawLine({ x1: 10, y1: 35, x2: 290, y2: 35, color: guide })
      .drawText({ ...common, value: "elephant", x: 20, y: 35 })
      .drawText({ ...common, value: "mouse", x: 170, y: 35 })
      .drawLine({ x1: 10, y1: 65, x2: 290, y2: 65, color: guide })
      .drawText({ ...common, value: "elephant", x: 20, y: 65, verticalAnchor: "text-top" })
      .drawText({ ...common, value: "mouse", x: 170, y: 65, verticalAnchor: "text-top" })
      .drawLine({ x1: 10, y1: 105, x2: 290, y2: 105, color: guide })
      .drawText({ ...common, value: "elephant", x: 20, y: 105, verticalAnchor: "font-top" })
      .drawText({ ...common, value: "mouse", x: 170, y: 105, verticalAnchor: "font-top" });

    await expectImageToMatchReference(
      image,
      reference("text-vertical-anchors.png"),
    );
  });

  test("Variable fonts", async () => {
    const path = imageFile("InterVariable.ttf");
    const light = Font.file({ path, axes: { wght: 100 } });
    const heavy = Font.file({ path, axes: { wght: 900 } });
    const black = Color.css({ value: "black" });

    const image = Image.blank({
      width: 420,
      height: 130,
      color: Color.css({ value: "white" }),
    })
      .drawText({
        value: "Inter Variable 100",
        x: 20,
        y: 50,
        size: 36,
        color: black,
        font: light,
      })
      .drawText({
        value: "Inter Variable 900",
        x: 20,
        y: 110,
        size: 36,
        color: black,
        font: heavy,
      });

    await expectImageToMatchReference(
      image,
      reference("text-variable-font-axes.png"),
    );
  });

  test("Soil moisture dashboard demo", async () => {
    const black = Color.css({ value: "black" });
    const fontPath = imageFile("InterVariable.ttf");
    const labelFont = Font.file({ path: fontPath, axes: { wght: 700 }, size: 14 });
    const numberFont = Font.file({ path: fontPath, axes: { wght: 700 }, size: 12 });
    const rows = [
      ["Lawn", 35],
      ["Greenhouse", 68],
      ["Front vegetables", 3],
      ["Rear vegetables", 95],
      ["Growbed", 52],
    ] as const;
    const nameX = 10;
    const numberX = 173;
    const barX = 176;
    const headerHeight = 24;
    const lineHeight = 16;
    const barWidth = 100;
    const barHeight = 8;

    let image = Image.blank({ width: 296, height: 128, color: Color.css({ value: "white" }) })
      .drawText({
        value: "Soil moisture",
        x: 148,
        y: 16,
        color: black,
        font: labelFont,
        anchor: "middle",
        verticalAnchor: "baseline",
      })
      .drawRect({ x: 10, y: 11, width: 76, height: 1, fill: black })
      .drawRect({ x: 210, y: 11, width: 77, height: 1, fill: black });

    rows.forEach(([name, moisture], index) => {
      const rowTop = headerHeight + index * lineHeight;
      const baselineY = rowTop + 11;
      image = image
        .drawText({ value: name, x: nameX, y: baselineY, color: black, font: labelFont, verticalAnchor: "baseline" })
        .drawText({
          value: `${moisture}\u2009%`,
          x: numberX,
          y: baselineY,
          color: black,
          font: numberFont,
          anchor: "end",
          verticalAnchor: "baseline",
        });

      if (moisture > 0) {
        image = image.drawRect({
          x: barX,
          y: rowTop + 3,
          width: moisture,
          height: barHeight,
          fill: black,
        });
      }
      image = image.drawRect({
        x: barX,
        y: rowTop + 3,
        width: barWidth,
        height: barHeight,
        stroke: black,
        strokeWidth: 1,
        strokePosition: "inside",
      });
    });

    await expectImageToMatchReference(image, reference("text-soil-moisture-dashboard.png"));
  });

  test("Waste collection schedule demo", async () => {
    const black = Color.css({ value: "black" });
    const red = Color.css({ value: "red" });
    const font = Font.file({
      path: imageFile("InterVariable.ttf"),
      axes: { wght: 700 },
      size: 22,
    });
    const labelX = 10;
    const valueX = 150;
    const headerHeight = 32;
    const lineHeight = 24;
    const rows = [
      ["General:", "in 3 days", false],
      ["Paper:", "in 3 days", false],
      ["Recyclables:", "in 3 days", true],
      ["Organic:", "in 3 days", false],
    ] as const;

    let image = Image.blank({ width: 296, height: 128, color: Color.css({ value: "white" }) })
      .drawText({
        value: "Waste pickup",
        x: 148,
        y: 5,
        color: black,
        font,
        anchor: "middle",
        verticalAnchor: "font-top",
      })
      .drawRect({ x: 10, y: 13, width: 64, height: 1, fill: black })
      .drawRect({ x: 223, y: 13, width: 64, height: 1, fill: black });

    rows.forEach(([label, value, valueIsRed], index) => {
      const y = headerHeight + index * lineHeight;
      image = image
        .drawText({
          value: label,
          x: labelX,
          y,
          color: black,
          font,
          verticalAnchor: "font-top",
        })
        .drawText({
          value,
          x: valueX,
          y,
          color: valueIsRed ? red : black,
          font,
          verticalAnchor: "font-top",
        });
    });

    const output = await image
      .thresholdChannels()
      .resize({ width: 800, mode: "cover", kernel: "nearest" })
      .toBuffer({
        format: "jpeg",
        quality: 100,
        chromaSubsampling: "4:4:4",
      });

    await expectImageToMatchReference(
      output,
      reference("text-waste-collection-schedule.png"),
    );
  });

});

function reference(name: string): URL {
  return new URL(`./references/${name}`, import.meta.url);
}

function imageFile(name: string): URL {
  return new URL(`./images/${name}`, import.meta.url);
}
