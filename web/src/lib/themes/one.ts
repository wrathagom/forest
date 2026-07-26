// web/src/lib/themes/one.ts
import { buildTheme } from "./build";

// Atom's official One palette publishes exactly three monochrome tones
// (mono-1/2/3) per mode — fg/fgDim/fgFaint below use all three, so there is
// no fourth, unused neutral to promote fgFaint to in either mode. mono-3
// reaches 2.32:1 (dark) / 2.47:1 (light) against its own bg, both just under
// the 2.5 floor. The palette's own "gutter" token moves the wrong direction
// (darkens further toward bg, away from more contrast). Reported, not
// invented.
export const oneDark = buildTheme({
  id: "one-dark", name: "One Dark", family: "One", scheme: "dark",
  bg: "#282c34", bg2: "#21252b", bg3: "#3e4451",
  fg: "#abb2bf", fgDim: "#828997", fgFaint: "#5c6370",
  border: "#3e4451", borderStrong: "#4b5263",
  accent: "#c678dd", accentFg: "#21252b",
  purple: "#c678dd", green: "#98c379", orange: "#d19a66", blue: "#61afef",
  cyan: "#56b6c2", yellow: "#e5c07b", red: "#e06c75", pink: "#c678dd",
  teal: "#56b6c2", comment: "#5c6370",
  charts: [
    "#61afef", "#c678dd", "#98c379", "#e5c07b",
    "#56b6c2", "#d19a66", "#e06c75", "#828997",
  ],
});

export const oneLight = buildTheme({
  id: "one-light", name: "One Light", family: "One", scheme: "light",
  bg: "#fafafa", bg2: "#f0f0f1", bg3: "#e5e5e6",
  fg: "#383a42", fgDim: "#696c77", fgFaint: "#a0a1a7",
  border: "#e5e5e6", borderStrong: "#d4d4d5",
  accent: "#a626a4", accentFg: "#fafafa",
  purple: "#a626a4", green: "#50a14f", orange: "#986801", blue: "#4078f2",
  cyan: "#0184bc", yellow: "#c18401", red: "#e45649", pink: "#a626a4",
  teal: "#0184bc", comment: "#a0a1a7",
  charts: [
    "#4078f2", "#a626a4", "#50a14f", "#c18401",
    "#0184bc", "#986801", "#e45649", "#696c77",
  ],
});
