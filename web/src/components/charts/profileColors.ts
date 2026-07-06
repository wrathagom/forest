// Categorical palette for per-profile (per-account) chart series. Distinct hues
// chosen to read on both light and dark backgrounds and to stay clear of the
// input/output/cache token colors. Swap for the dataviz skill's palette if desired.
export const PROFILE_PALETTE = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#34d399", // green
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#a3e635", // lime
];

// Maps profile keys (in the caller's stable order) to palette colors, cycling
// if there are more profiles than colors. Consumers (time chart + legend) share
// this map so a profile always gets the same color.
export function profileColorMap(profiles: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  profiles.forEach((p, i) => {
    map[p] = PROFILE_PALETTE[i % PROFILE_PALETTE.length]!;
  });
  return map;
}
