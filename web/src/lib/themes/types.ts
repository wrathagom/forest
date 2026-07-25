// Light/dark drives the CSS `color-scheme` property, which is what makes
// native scrollbars and form controls follow the theme.
export type ThemeScheme = "light" | "dark";

export type ThemeTokens = {
  // surfaces
  bg: string; bg2: string; bg3: string;
  // text
  fg: string; fgDim: string; fgFaint: string;
  // lines
  border: string; borderStrong: string;
  // roles. `accent` is brand/selection; `ok` is positive state. They are
  // separate because Forest's accent happens to be green today, but under a
  // theme with a purple accent every added diff line would render purple.
  accent: string; accentFg: string;
  ok: string; warn: string; error: string; info: string;
  // codemirror syntax
  synKeyword: string; synString: string; synNumber: string;
  synFunction: string; synProperty: string; synType: string;
  synTag: string; synComment: string; synOperator: string; synInvalid: string;
  // categorical chart series
  chart1: string; chart2: string; chart3: string; chart4: string;
  chart5: string; chart6: string; chart7: string; chart8: string;
  // xterm (background/foreground/cursor only — ANSI 0-15 stay xterm's defaults)
  termBg: string; termFg: string; termCursor: string;
  // token meter
  tokIn: string; tokOut: string; tokCache: string;
};

export type Theme = {
  id: string;          // "catppuccin-mocha" — the value stored in localStorage
  name: string;        // "Mocha" — shown in the picker
  family: string;      // "Catppuccin" — groups cards in the picker
  scheme: ThemeScheme;
  tokens: ThemeTokens;
};

// Exhaustive by construction: omitting a ThemeTokens key here is a compile
// error, so TOKEN_KEYS can never drift from the type.
const TOKEN_KEY_MAP: Record<keyof ThemeTokens, true> = {
  bg: true, bg2: true, bg3: true,
  fg: true, fgDim: true, fgFaint: true,
  border: true, borderStrong: true,
  accent: true, accentFg: true, ok: true, warn: true, error: true, info: true,
  synKeyword: true, synString: true, synNumber: true, synFunction: true,
  synProperty: true, synType: true, synTag: true, synComment: true,
  synOperator: true, synInvalid: true,
  chart1: true, chart2: true, chart3: true, chart4: true,
  chart5: true, chart6: true, chart7: true, chart8: true,
  termBg: true, termFg: true, termCursor: true,
  tokIn: true, tokOut: true, tokCache: true,
};

export const TOKEN_KEYS = Object.keys(TOKEN_KEY_MAP) as (keyof ThemeTokens)[];
