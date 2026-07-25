import { currentTheme } from "../../lib/themes/current";

// Categorical palette for per-profile (per-account) chart series, read from the
// active theme. Literal colors rather than `var(--chart-N)`: reading the
// registry is what makes consumers re-run on a theme change, and it keeps the
// palette usable from contexts where a CSS variable would not resolve (SVG
// presentation attributes, canvas).
export function profilePalette(): string[] {
  const { tokens } = currentTheme();
  return [
    tokens.chart1, tokens.chart2, tokens.chart3, tokens.chart4,
    tokens.chart5, tokens.chart6, tokens.chart7, tokens.chart8,
  ];
}

// Maps profile keys (in the caller's stable order) to palette colors, cycling
// if there are more profiles than colors. Consumers (time chart + legend) share
// this map so a profile always gets the same color. Reading currentTheme() via
// profilePalette() means callers that invoke this inside a memo or render path
// recolor themselves when the theme changes.
export function profileColorMap(profiles: string[]): Record<string, string> {
  const palette = profilePalette();
  const map: Record<string, string> = {};
  profiles.forEach((p, i) => {
    map[p] = palette[i % palette.length]!;
  });
  return map;
}
