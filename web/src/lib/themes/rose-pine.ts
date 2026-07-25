// web/src/lib/themes/rose-pine.ts
import { buildTheme } from "./build";

export const rosePine = buildTheme({
  id: "rose-pine", name: "Rosé Pine", family: "Rosé Pine", scheme: "dark",
  bg: "#191724", bg2: "#1f1d2e", bg3: "#26233a",
  fg: "#e0def4", fgDim: "#908caa", fgFaint: "#6e6a86",
  border: "#26233a", borderStrong: "#403d52",
  accent: "#c4a7e7", accentFg: "#191724",
  purple: "#c4a7e7", green: "#9ccfd8", orange: "#f6c177", blue: "#31748f",
  cyan: "#9ccfd8", yellow: "#f6c177", red: "#eb6f92", pink: "#ebbcba",
  teal: "#31748f", comment: "#6e6a86",
  charts: [
    "#31748f", "#eb6f92", "#9ccfd8", "#f6c177",
    "#c4a7e7", "#ebbcba", "#908caa", "#6e6a86",
  ],
});

export const rosePineDawn = buildTheme({
  id: "rose-pine-dawn", name: "Dawn", family: "Rosé Pine", scheme: "light",
  bg: "#faf4ed", bg2: "#fffaf3", bg3: "#f2e9e1",
  fg: "#575279", fgDim: "#797593", fgFaint: "#9893a5",
  border: "#dfdad9", borderStrong: "#cecacd",
  // accentFg is surface (#fffaf3), Dawn's lightest published tone, not base
  // (#faf4ed, this theme's own bg): base only reaches 3.47:1 against iris
  // (#907aa9), surface reaches 3.65:1. Iris sits mid-luminance in Dawn's
  // range, so no published neutral — light or dark — clears 4.5:1 against
  // it; surface is the best available, still short. Reported, not invented.
  accent: "#907aa9", accentFg: "#fffaf3",
  purple: "#907aa9", green: "#56949f", orange: "#ea9d34", blue: "#286983",
  cyan: "#56949f", yellow: "#ea9d34", red: "#b4637a", pink: "#d7827e",
  teal: "#286983", comment: "#9893a5",
  charts: [
    "#286983", "#b4637a", "#56949f", "#ea9d34",
    "#907aa9", "#d7827e", "#797593", "#9893a5",
  ],
});
