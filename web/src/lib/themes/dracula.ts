// web/src/lib/themes/dracula.ts
import { buildTheme } from "./build";

// Dracula's comment colour #6272a4 reaches only ~2.8:1 on its background, so it
// serves as fgFaint rather than fgDim. fgDim is derived: mix(fg, bg, 35%).
export const dracula = buildTheme({
  id: "dracula", name: "Dracula", family: "Dracula", scheme: "dark",
  bg: "#282a36", bg2: "#21222c", bg3: "#343746",
  fg: "#f8f8f2", fgDim: "#afb0b0", fgFaint: "#6272a4",
  border: "#44475a", borderStrong: "#6272a4",
  accent: "#bd93f9", accentFg: "#21222c",
  purple: "#bd93f9", green: "#50fa7b", orange: "#ffb86c", blue: "#8be9fd",
  cyan: "#8be9fd", yellow: "#f1fa8c", red: "#ff5555", pink: "#ff79c6",
  teal: "#50fa7b", comment: "#6272a4",
  charts: [
    "#8be9fd", "#ff79c6", "#50fa7b", "#f1fa8c",
    "#bd93f9", "#ffb86c", "#ff5555", "#6272a4",
  ],
});
