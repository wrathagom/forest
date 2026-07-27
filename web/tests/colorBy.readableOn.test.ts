import { describe, expect, test } from "vitest";
import { readableOn } from "../src/lib/colorBy";
import { contrast } from "../src/lib/contrast";

// A dark theme's neutrals and a light theme's neutrals.
const DARK = { bg: "#0e0e10", fg: "#e6e6e6" };
const LIGHT = { bg: "#fdf6e3", fg: "#657b83" };

describe("readableOn", () => {
  test("picks a theme-native tone when one clears 4.5:1", () => {
    // #f59e0b (amber) against a near-black bg is ~9.0:1.
    expect(readableOn("#f59e0b", DARK)).toBe(DARK.bg);
  });

  test("falls back to absolute black when neither native tone clears", () => {
    // Solarized Light: neither #fdf6e3 nor #657b83 clears 4.5:1 on its own bg3.
    const out = readableOn("#eee8d5", LIGHT);
    expect(out).toBe("#000000");
  });

  test("falls back to white when both native tones miss and the hue sits under the crossover", () => {
    // #6c6c6c has L≈0.150, just below the 0.179 crossover. Against DARK,
    // bg is 3.67:1 and fg is 4.21:1 — both miss the floor — and white
    // (5.25:1) beats black (4.00:1).
    expect(readableOn("#6c6c6c", DARK)).toBe("#ffffff");
  });

  test("falls back to black when the hue sits just above the crossover", () => {
    // #767676, L≈0.181. bg 4.25:1 and fg 3.64:1 both miss; now black
    // (4.62:1) edges out white (4.54:1). This is the mirror of the test
    // above and pins the branch that picks between the two absolutes.
    expect(readableOn("#767676", DARK)).toBe("#000000");
  });

  test("falls back to white in a light theme too", () => {
    // #747474, L≈0.175. LIGHT.bg is 4.33:1 and LIGHT.fg only 1.05:1, so both
    // miss; white wins at 4.67:1 over black's 4.49:1.
    expect(readableOn("#747474", LIGHT)).toBe("#ffffff");
  });

  test("always clears 4.5:1 across the black/white crossover region", () => {
    // L ~= 0.179 is where black and white are equally bad (both 4.58:1).
    // Of these four, #767676/#7a7a7a/#6f6f6f miss the native tones and hit
    // the black/white fallback; #808080 clears via DARK.bg directly. Either
    // way, the floor holds.
    for (const hue of ["#767676", "#7a7a7a", "#808080", "#6f6f6f"]) {
      const fg = readableOn(hue, DARK);
      expect(contrast(fg, hue), `${hue} -> ${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("is deterministic", () => {
    expect(readableOn("#6ee7b7", DARK)).toBe(readableOn("#6ee7b7", DARK));
  });
});
