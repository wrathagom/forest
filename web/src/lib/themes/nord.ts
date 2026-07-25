// web/src/lib/themes/nord.ts
import { buildTheme } from "./build";

// fgFaint is nord3_gui_bright (#616e88), a brightened nord3 shipped in the
// official nord-vim/nordtheme ports specifically because raw nord3 (#4c566a,
// used for borderStrong) is nearly unreadable as text — it reaches only
// 1.69:1 against nord0. The brightened tone is already the best published
// "faint" option and still only reaches 2.43:1, just under the 2.5 floor;
// the next official tone up, nord4, is already fgDim and jumps to 9.25:1 —
// far past "faint". No unused Nord tone bridges the gap. Reported, not
// invented.
export const nord = buildTheme({
  id: "nord", name: "Nord", family: "Nord", scheme: "dark",
  bg: "#2e3440", bg2: "#3b4252", bg3: "#434c5e",
  fg: "#eceff4", fgDim: "#d8dee9", fgFaint: "#616e88",
  border: "#434c5e", borderStrong: "#4c566a",
  accent: "#88c0d0", accentFg: "#2e3440",
  purple: "#b48ead", green: "#a3be8c", orange: "#d08770", blue: "#81a1c1",
  cyan: "#88c0d0", yellow: "#ebcb8b", red: "#bf616a", pink: "#b48ead",
  teal: "#8fbcbb", comment: "#616e88",
  charts: [
    "#81a1c1", "#b48ead", "#a3be8c", "#ebcb8b",
    "#88c0d0", "#d08770", "#bf616a", "#8fbcbb",
  ],
});
