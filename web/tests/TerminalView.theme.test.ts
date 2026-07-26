import { describe, expect, test } from "vitest";
import { xtermTheme } from "../src/components/TerminalView";
import { buildTheme } from "../src/lib/themes/build";

const theme = buildTheme({
  id: "x", name: "X", family: "X", scheme: "dark",
  bg: "#1e1e2e", bg2: "#181825", bg3: "#313244",
  fg: "#cdd6f4", fgDim: "#a6adc8", fgFaint: "#6c7086",
  border: "#313244", borderStrong: "#45475a",
  accent: "#cba6f7", accentFg: "#11111b",
  ok: "#a6e3a1", warn: "#f9e2af", error: "#f38ba8", info: "#89b4fa",
  purple: "#cba6f7", green: "#a6e3a1", orange: "#fab387", blue: "#89b4fa",
  cyan: "#89dceb", yellow: "#f9e2af", red: "#f38ba8", pink: "#f5c2e7",
  teal: "#94e2d5", comment: "#7f849c",
});

describe("xtermTheme", () => {
  test("maps background, foreground and cursor", () => {
    expect(xtermTheme(theme)).toEqual({
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#cba6f7",
    });
  });

  test("sets no ANSI slots, leaving xterm's defaults alone", () => {
    const keys = Object.keys(xtermTheme(theme));
    expect(keys).toHaveLength(3);
    expect(keys.some((k) => /^(bright)?(black|red|green|yellow|blue|magenta|cyan|white)$/.test(k))).toBe(false);
  });
});
