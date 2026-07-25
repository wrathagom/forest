// web/src/lib/themes/forest-dark.ts
import { buildTheme } from "./build";

// Forest's original palette. Values come straight from styles.css, the
// CodeMirror highlight in FileEditor.tsx, and PROFILE_PALETTE, so this theme
// is byte-identical to the pre-theming look.
export const forestDark = buildTheme({
  id: "forest-dark", name: "Forest Dark", family: "Forest", scheme: "dark",

  bg: "#0e0e10", bg2: "#1a1a1d", bg3: "#0e0e10",
  fg: "#e6e6e6", fgDim: "#9a9a9a", fgFaint: "#666666",
  border: "#2a2a2d", borderStrong: "#3a3a3d",

  accent: "#6ee7b7", accentFg: "#0e0e10",

  // Forest Dark is the one theme where the role colors genuinely differ from
  // the syntax hues, so they are explicit: the success green is the accent
  // green (#6ee7b7), not the string green (#c3e88d). `info` is omitted because
  // it equals `blue` and the default already produces it.
  ok: "#6ee7b7", warn: "#f59e0b", error: "#f87171",

  purple: "#c792ea", green: "#c3e88d", orange: "#f78c6c", blue: "#82aaff",
  cyan: "#89ddff", yellow: "#ffcb6b", red: "#f07178", pink: "#f472b6",
  teal: "#34d399", comment: "#546e7a",

  // The exact PROFILE_PALETTE from charts/profileColors.ts, so existing charts
  // do not shift colour when this theme is applied.
  charts: [
    "#60a5fa", "#f472b6", "#34d399", "#fbbf24",
    "#a78bfa", "#22d3ee", "#fb923c", "#a3e635",
  ],

  overrides: {
    // CodeMirror used a distinct invalid red, not the tag red.
    synInvalid: "#ff5370",
    // The token meter had its own violet.
    tokIn: "#6ee7b7", tokOut: "#f59e0b", tokCache: "#8b5cf6",
  },
});
