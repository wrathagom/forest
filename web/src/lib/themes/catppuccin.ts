// web/src/lib/themes/catppuccin.ts
import { buildTheme } from "./build";

export const catppuccinLatte = buildTheme({
  id: "catppuccin-latte", name: "Latte", family: "Catppuccin", scheme: "light",
  bg: "#eff1f5", bg2: "#e6e9ef", bg3: "#ccd0da",
  fg: "#4c4f69", fgDim: "#6c6f85", fgFaint: "#9ca0b0",
  border: "#ccd0da", borderStrong: "#bcc0cc",
  accent: "#8839ef", accentFg: "#eff1f5",
  purple: "#8839ef", green: "#40a02b", orange: "#fe640b", blue: "#1e66f5",
  cyan: "#04a5e5", yellow: "#df8e1d", red: "#d20f39", pink: "#ea76cb",
  teal: "#179299", comment: "#8c8fa1",
});

export const catppuccinFrappe = buildTheme({
  id: "catppuccin-frappe", name: "Frappé", family: "Catppuccin", scheme: "dark",
  bg: "#303446", bg2: "#292c3c", bg3: "#414559",
  fg: "#c6d0f5", fgDim: "#a5adce", fgFaint: "#737994",
  border: "#414559", borderStrong: "#51576d",
  accent: "#ca9ee6", accentFg: "#232634",
  purple: "#ca9ee6", green: "#a6d189", orange: "#ef9f76", blue: "#8caaee",
  cyan: "#99d1db", yellow: "#e5c890", red: "#e78284", pink: "#f4b8e4",
  teal: "#81c8be", comment: "#838ba7",
});

export const catppuccinMacchiato = buildTheme({
  id: "catppuccin-macchiato", name: "Macchiato", family: "Catppuccin", scheme: "dark",
  bg: "#24273a", bg2: "#1e2030", bg3: "#363a4f",
  fg: "#cad3f5", fgDim: "#a5adcb", fgFaint: "#6e738d",
  border: "#363a4f", borderStrong: "#494d64",
  accent: "#c6a0f6", accentFg: "#181926",
  purple: "#c6a0f6", green: "#a6da95", orange: "#f5a97f", blue: "#8aadf4",
  cyan: "#91d7e3", yellow: "#eed49f", red: "#ed8796", pink: "#f5bde6",
  teal: "#8bd5ca", comment: "#8087a2",
});

export const catppuccinMocha = buildTheme({
  id: "catppuccin-mocha", name: "Mocha", family: "Catppuccin", scheme: "dark",
  bg: "#1e1e2e", bg2: "#181825", bg3: "#313244",
  fg: "#cdd6f4", fgDim: "#a6adc8", fgFaint: "#6c7086",
  border: "#313244", borderStrong: "#45475a",
  accent: "#cba6f7", accentFg: "#11111b",
  purple: "#cba6f7", green: "#a6e3a1", orange: "#fab387", blue: "#89b4fa",
  cyan: "#89dceb", yellow: "#f9e2af", red: "#f38ba8", pink: "#f5c2e7",
  teal: "#94e2d5", comment: "#7f849c",
});
