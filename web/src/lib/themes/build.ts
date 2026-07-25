import type { Theme, ThemeScheme, ThemeTokens } from "./types";

// A theme is authored as its own published palette plus role assignments.
// buildTheme expands that into the full 38-token set using the mapping recipe
// from the design doc, so the recipe lives in exactly one place instead of
// being copy-pasted into 16 theme files.
export type ThemeInput = {
  id: string;
  name: string;
  family: string;
  scheme: ThemeScheme;

  // surfaces / text / lines
  bg: string; bg2: string; bg3: string;
  fg: string; fgDim: string; fgFaint: string;
  border: string; borderStrong: string;

  // roles
  accent: string; accentFg: string;

  // Default to the theme's corresponding hue, because in most published
  // palettes they are literally the same value — Catppuccin's `ok` IS its
  // green. Pass one explicitly only where it differs: Forest Dark's success
  // green (#6ee7b7) is not its syntax-string green (#c3e88d).
  ok?: string; warn?: string; error?: string; info?: string;

  // named hues, used to derive syntax and chart colors
  purple: string; green: string; orange: string; blue: string;
  cyan: string; yellow: string; red: string; pink: string;
  teal: string; comment: string;

  // Categorical chart series. Defaults to the eight named hues, which only
  // works for palettes that publish eight distinct ones. Most families
  // collapse at least two — Dracula's blue and cyan are the same hex — so
  // they pass a tuple. A tuple rather than eight `chartN` override lines
  // keeps the "8 distinct colors" requirement visible where it is authored.
  charts?: readonly [string, string, string, string, string, string, string, string];

  // Last-resort escape hatch for a single token that fits no other rule.
  overrides?: Partial<ThemeTokens>;
};

export function buildTheme(i: ThemeInput): Theme {
  const ok = i.ok ?? i.green;
  const warn = i.warn ?? i.yellow;
  const error = i.error ?? i.red;
  const info = i.info ?? i.blue;
  const charts =
    i.charts ?? [i.blue, i.pink, i.green, i.yellow, i.purple, i.cyan, i.orange, i.teal];

  const tokens: ThemeTokens = {
    bg: i.bg, bg2: i.bg2, bg3: i.bg3,
    fg: i.fg, fgDim: i.fgDim, fgFaint: i.fgFaint,
    border: i.border, borderStrong: i.borderStrong,
    accent: i.accent, accentFg: i.accentFg,
    ok, warn, error, info,

    synKeyword: i.purple,
    synString: i.green,
    synNumber: i.orange,
    synFunction: i.blue,
    synProperty: i.cyan,
    synType: i.yellow,
    synTag: i.red,
    synComment: i.comment,
    synOperator: i.cyan,
    synInvalid: i.red,

    chart1: charts[0], chart2: charts[1], chart3: charts[2], chart4: charts[3],
    chart5: charts[4], chart6: charts[5], chart7: charts[6], chart8: charts[7],

    termBg: i.bg, termFg: i.fg, termCursor: i.accent,

    tokIn: i.green, tokOut: i.orange, tokCache: i.purple,

    ...i.overrides,
  };

  return { id: i.id, name: i.name, family: i.family, scheme: i.scheme, tokens };
}
