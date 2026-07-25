import { describe, expect, test } from "vitest";
import { buildTheme, type ThemeInput } from "../src/lib/themes/build";
import { TOKEN_KEYS } from "../src/lib/themes/types";

const INPUT: ThemeInput = {
  id: "t", name: "T", family: "F", scheme: "dark",
  bg: "#000000", bg2: "#010101", bg3: "#020202",
  fg: "#ffffff", fgDim: "#cccccc", fgFaint: "#888888",
  border: "#020202", borderStrong: "#030303",
  accent: "#aa00ff", accentFg: "#000000",
  ok: "#00ff00", warn: "#ffff00", error: "#ff0000", info: "#0000ff",
  purple: "#aa00ff", green: "#00ff00", orange: "#ff8800", blue: "#0000ff",
  cyan: "#00ffff", yellow: "#ffff00", red: "#ff0000", pink: "#ff00ff",
  teal: "#008888", comment: "#666666",
};

describe("buildTheme", () => {
  test("produces every token", () => {
    const theme = buildTheme(INPUT);
    for (const key of TOKEN_KEYS) {
      expect(theme.tokens[key], `missing ${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("applies the syntax recipe", () => {
    const { tokens } = buildTheme(INPUT);
    expect(tokens.synKeyword).toBe(INPUT.purple);
    expect(tokens.synString).toBe(INPUT.green);
    expect(tokens.synComment).toBe(INPUT.comment);
  });

  test("terminal defaults to bg/fg/accent", () => {
    const { tokens } = buildTheme(INPUT);
    expect(tokens.termBg).toBe(INPUT.bg);
    expect(tokens.termFg).toBe(INPUT.fg);
    expect(tokens.termCursor).toBe(INPUT.accent);
  });

  test("overrides win", () => {
    const { tokens } = buildTheme({ ...INPUT, overrides: { termBg: "#123456", chart1: "#654321" } });
    expect(tokens.termBg).toBe("#123456");
    expect(tokens.chart1).toBe("#654321");
    expect(tokens.termFg).toBe(INPUT.fg); // untouched
  });

  test("carries identity through", () => {
    const theme = buildTheme(INPUT);
    expect(theme.id).toBe("t");
    expect(theme.family).toBe("F");
    expect(theme.scheme).toBe("dark");
  });
});
