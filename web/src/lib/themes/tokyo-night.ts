// web/src/lib/themes/tokyo-night.ts
import { buildTheme } from "./build";

export const tokyoNight = buildTheme({
  id: "tokyo-night", name: "Tokyo Night", family: "Tokyo Night", scheme: "dark",
  bg: "#1a1b26", bg2: "#16161e", bg3: "#292e42",
  fg: "#c0caf5", fgDim: "#a9b1d6", fgFaint: "#565f89",
  border: "#292e42", borderStrong: "#3b4261",
  accent: "#bb9af7", accentFg: "#16161e",
  purple: "#bb9af7", green: "#9ece6a", orange: "#ff9e64", blue: "#7aa2f7",
  cyan: "#7dcfff", yellow: "#e0af68", red: "#f7768e", pink: "#bb9af7",
  teal: "#1abc9c", comment: "#565f89",
  charts: [
    "#7aa2f7", "#bb9af7", "#9ece6a", "#e0af68",
    "#7dcfff", "#ff9e64", "#f7768e", "#1abc9c",
  ],
});
