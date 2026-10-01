import { describe, expect, test } from "vitest";
import { Color } from "../src/index.js";

describe("Colors", () => {
  test("RGB components outside their ranges are rejected", () => {
    expect(() => Color.rgb(-1, 0, 0)).toThrow("Red must be a finite number between 0 and 255.");
    expect(() => Color.rgb(0, 256, 0)).toThrow("Green must be a finite number between 0 and 255.");
    expect(() => Color.rgb(0, 0, Number.NaN)).toThrow("Blue must be a finite number between 0 and 255.");
    expect(() => Color.rgb(0, 0, 0, 1.1)).toThrow("Alpha must be a finite number between 0 and 1.");
  });

  test("Empty CSS color values are rejected", () => {
    expect(() => Color.css({ value: "" })).toThrow("CSS color value must not be empty.");
  });
});
