export interface CssColorOptions {
  value: string;
}

type ColorValue =
  | {
      kind: "rgb";
      red: number;
      green: number;
      blue: number;
      alpha: number;
    }
  | { kind: "css"; value: string };

export type SharpColor = string | { r: number; g: number; b: number; alpha: number };

const values = new WeakMap<Color, ColorValue>();

/** An immutable color value. */
export class Color {
  /** An opaque color for contexts, such as alpha masks, where RGB is irrelevant. */
  static readonly opaque = new Color({ kind: "rgb", red: 0, green: 0, blue: 0, alpha: 1 });

  private constructor(value: ColorValue) {
    values.set(this, value);
    Object.freeze(this);
  }

  /**
   * Creates a non-premultiplied sRGB color.
   *
   * RGB components use the range 0–255. Alpha uses the range 0–1 and
   * defaults to 1.
   */
  static rgb(red: number, green: number, blue: number, alpha = 1): Color {
    assertComponent("Red", red, 255);
    assertComponent("Green", green, 255);
    assertComponent("Blue", blue, 255);
    assertComponent("Alpha", alpha, 1);

    return new Color({
      kind: "rgb",
      red: red / 255,
      green: green / 255,
      blue: blue / 255,
      alpha
    });
  }

  /** Creates a color from a CSS color value. */
  static css(options: CssColorOptions): Color {
    if (options.value.length === 0) {
      throw new Error("CSS color value must not be empty.");
    }

    return new Color({ kind: "css", value: options.value });
  }
}

export function colorToSharp(color: Color): SharpColor {
  const value = colorValue(color);
  if (value.kind === "css") {
    return value.value;
  }

  return {
    r: value.red * 255,
    g: value.green * 255,
    b: value.blue * 255,
    alpha: value.alpha
  };
}

export function colorToCss(color: Color): string {
  const value = colorValue(color);
  if (value.kind === "css") {
    return value.value;
  }

  const red = value.red * 255;
  const green = value.green * 255;
  const blue = value.blue * 255;
  return `rgba(${red}, ${green}, ${blue}, ${value.alpha})`;
}

function colorValue(color: Color): ColorValue {
  const value = values.get(color);
  if (value === undefined) {
    throw new Error("Invalid Color value.");
  }

  return value;
}

function assertComponent(name: string, value: number, maximum: number): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be a finite number between 0 and ${maximum}.`);
  }
}
