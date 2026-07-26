import { describe, expect, test } from "vitest";
import { contrast, luminance, parseHex, mixHex } from "../src/lib/contrast";

describe("parseHex", () => {
  test("parses a 6-digit hex", () => {
    expect(parseHex("#ff8000")).toEqual([255, 128, 0]);
  });

  test("throws on anything else", () => {
    expect(() => parseHex("#fff")).toThrow();
  });
});

describe("luminance", () => {
  test("black is 0 and white is 1", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  test("per-channel weights are not transposed", () => {
    // The WCAG weights are 0.2126 red, 0.7152 green, 0.0722 blue. Pure
    // red/green/blue inputs zero out the other two channels, so this pins
    // each coefficient individually rather than an average that a
    // transposition (e.g. swapping the red and blue weights) could still pass.
    const red = luminance("#ff0000");
    const green = luminance("#00ff00");
    const blue = luminance("#0000ff");
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(red).toBeCloseTo(0.2126, 4);
    expect(green).toBeCloseTo(0.7152, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
  });
});

describe("contrast", () => {
  test("black on white is 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  test("is symmetric", () => {
    expect(contrast("#ff5555", "#282a36")).toBeCloseTo(contrast("#282a36", "#ff5555"), 6);
  });

  test("a color against itself is 1:1", () => {
    expect(contrast("#6ee7b7", "#6ee7b7")).toBeCloseTo(1, 6);
  });

  test("Dracula's error red on its background clears 4.5:1 but isn't wildly over", () => {
    // Real chromatic pair (not black/white), so a per-channel bug in
    // luminance would actually move this number. Measured value is ~4.53:1.
    const ratio = contrast("#ff5555", "#282a36");
    expect(ratio).toBeGreaterThan(4.5);
    expect(ratio).toBeLessThan(5);
  });
});

describe("mixHex", () => {
  test("100% of a is a, 0% is b", () => {
    expect(mixHex("#ffffff", "#000000", 100)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#000000", 0)).toBe("#000000");
  });

  test("50% of white and black is mid grey", () => {
    expect(mixHex("#ffffff", "#000000", 50)).toBe("#808080");
  });

  test("mixes each channel independently, not with a shared factor", () => {
    // Red and blue don't share a nonzero channel, so if the implementation
    // reused one channel's blend factor for all three, this would produce a
    // different (wrong) result instead of #800080.
    expect(mixHex("#ff0000", "#0000ff", 50)).toBe("#800080");
  });

  test("clamps out-of-range percentages", () => {
    expect(mixHex("#ffffff", "#000000", 150)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#000000", -20)).toBe("#000000");
  });
});
