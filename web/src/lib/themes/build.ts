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
  ok: string; warn: string; error: string; info: string;

  // named hues, used to derive syntax and chart colors
  purple: string; green: string; orange: string; blue: string;
  cyan: string; yellow: string; red: string; pink: string;
  teal: string; comment: string;

  // escape hatch for themes whose palette does not fit the recipe — e.g. a
  // family with fewer than 8 distinct hues needs explicit chart colors.
  overrides?: Partial<ThemeTokens>;
};

export function buildTheme(i: ThemeInput): Theme {
  const tokens: ThemeTokens = {
    bg: i.bg, bg2: i.bg2, bg3: i.bg3,
    fg: i.fg, fgDim: i.fgDim, fgFaint: i.fgFaint,
    border: i.border, borderStrong: i.borderStrong,
    accent: i.accent, accentFg: i.accentFg,
    ok: i.ok, warn: i.warn, error: i.error, info: i.info,

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

    chart1: i.blue, chart2: i.pink, chart3: i.green, chart4: i.yellow,
    chart5: i.purple, chart6: i.cyan, chart7: i.orange, chart8: i.teal,

    termBg: i.bg, termFg: i.fg, termCursor: i.accent,

    tokIn: i.green, tokOut: i.orange, tokCache: i.purple,

    ...i.overrides,
  };

  return { id: i.id, name: i.name, family: i.family, scheme: i.scheme, tokens };
}
