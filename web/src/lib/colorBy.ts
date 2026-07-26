import { contrast } from "./contrast";

/** WCAG AA for normal-size text. The card title is 13px semibold, which is
 *  below the 18.66px "large text" threshold, so 4.5 applies rather than 3.0. */
const FLOOR = 4.5;

/**
 * Pick a readable foreground for text sitting on `hue`.
 *
 * Prefers one of the theme's own neutrals so the band stays theme-flavored,
 * and only falls back to absolute black/white when neither clears the floor.
 * A tie between the two neutrals favors `bg`.
 * That fallback is always sufficient: for a hue of relative luminance L,
 * contrast against black is (L+0.05)/0.05 and against white is 1.05/(L+0.05).
 * They are equal at L ~= 0.179, where both are 4.58:1 — the minimum of the
 * maximum — so max(black, white) is never below 4.58:1 for any color.
 */
export function readableOn(hue: string, neutrals: { bg: string; fg: string }): string {
  const { bg, fg } = neutrals;
  let best = bg;
  let bestRatio = 0;
  for (const candidate of [bg, fg]) {
    const ratio = contrast(candidate, hue);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  if (bestRatio >= FLOOR) return best;
  return contrast("#000000", hue) >= contrast("#ffffff", hue) ? "#000000" : "#ffffff";
}
