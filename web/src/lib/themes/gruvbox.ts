// web/src/lib/themes/gruvbox.ts
import { buildTheme } from "./build";

export const gruvboxDark = buildTheme({
  id: "gruvbox-dark", name: "Gruvbox Dark", family: "Gruvbox", scheme: "dark",
  bg: "#282828", bg2: "#1d2021", bg3: "#3c3836",
  fg: "#ebdbb2", fgDim: "#bdae93", fgFaint: "#928374",
  border: "#3c3836", borderStrong: "#504945",
  accent: "#83a598", accentFg: "#1d2021",
  purple: "#d3869b", green: "#b8bb26", orange: "#fe8019", blue: "#83a598",
  cyan: "#8ec07c", yellow: "#fabd2f", red: "#fb4934", pink: "#d3869b",
  teal: "#8ec07c", comment: "#928374",
  charts: [
    "#83a598", "#d3869b", "#b8bb26", "#fabd2f",
    "#8ec07c", "#fe8019", "#fb4934", "#928374",
  ],
});

export const gruvboxLight = buildTheme({
  id: "gruvbox-light", name: "Gruvbox Light", family: "Gruvbox", scheme: "light",
  bg: "#fbf1c7", bg2: "#f9f5d7", bg3: "#ebdbb2",
  fg: "#3c3836", fgDim: "#665c54", fgFaint: "#928374",
  border: "#ebdbb2", borderStrong: "#d5c4a1",
  accent: "#076678", accentFg: "#fbf1c7",
  purple: "#8f3f71", green: "#79740e", orange: "#af3a03", blue: "#076678",
  cyan: "#427b58", yellow: "#b57614", red: "#9d0006", pink: "#8f3f71",
  teal: "#427b58", comment: "#928374",
  charts: [
    "#076678", "#8f3f71", "#79740e", "#b57614",
    "#427b58", "#af3a03", "#9d0006", "#7c6f64",
  ],
});
