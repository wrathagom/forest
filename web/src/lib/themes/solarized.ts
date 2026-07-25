// web/src/lib/themes/solarized.ts
import { buildTheme } from "./build";

// Solarized's eight accents are shared verbatim between the light and dark
// modes — that is the point of the palette.
const A = {
  yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682",
  violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900",
} as const;

// accentFg is base03, the darkest of Solarized's eight monotones — the best
// available contrast against the shared blue accent (#268bd2) at 4.08:1.
// None of the other seven monotones do better (base3, the lightest, only
// reaches 3.41:1); Solarized simply has no tone that clears 4.5:1 against its
// own blue. Reported, not papered over with an invented hex.
export const solarizedDark = buildTheme({
  id: "solarized-dark", name: "Solarized Dark", family: "Solarized", scheme: "dark",
  bg: "#002b36", bg2: "#073642", bg3: "#073642",
  fg: "#93a1a1", fgDim: "#839496", fgFaint: "#586e75",
  border: "#073642", borderStrong: "#586e75",
  accent: A.blue, accentFg: "#002b36",
  purple: A.violet, green: A.green, orange: A.orange, blue: A.blue,
  cyan: A.cyan, yellow: A.yellow, red: A.red, pink: A.magenta,
  teal: A.cyan, comment: "#586e75",
  charts: [
    A.blue, A.magenta, A.green, A.yellow,
    A.violet, A.cyan, A.orange, A.red,
  ],
});

export const solarizedLight = buildTheme({
  id: "solarized-light", name: "Solarized Light", family: "Solarized", scheme: "light",
  bg: "#fdf6e3", bg2: "#eee8d5", bg3: "#eee8d5",
  fg: "#586e75", fgDim: "#657b83",
  // fgFaint is base0, not base1: base1 (#93a1a1, still used for comment and
  // borderStrong) is Solarized's lightest content tone and only reaches
  // 2.48:1 against this light bg — just under the 2.5 floor. base0 is the
  // next darker published tone, unused elsewhere in this mapping, and clears
  // at 2.93:1 while staying below fgDim's 4.13:1.
  fgFaint: "#839496",
  border: "#eee8d5", borderStrong: "#93a1a1",
  // accentFg is base03 (Solarized's darkest tone) rather than base3 (its own
  // bg): base3 only reaches 3.41:1 against the blue accent, base03 reaches
  // 4.08:1 — the same ceiling solarizedDark hits, since both share one blue
  // and one set of monotones. Still short of 4.5:1; no Solarized tone clears
  // it against this blue.
  accent: A.blue, accentFg: "#002b36",
  purple: A.violet, green: A.green, orange: A.orange, blue: A.blue,
  cyan: A.cyan, yellow: A.yellow, red: A.red, pink: A.magenta,
  teal: A.cyan, comment: "#93a1a1",
  charts: [
    A.blue, A.magenta, A.green, A.yellow,
    A.violet, A.cyan, A.orange, A.red,
  ],
});
