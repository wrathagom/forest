import type { ProjectRow } from "../api";
import type { Theme } from "./themes/types";
import { contrast, mixHex } from "./contrast";
import { lastActivity } from "./project-list";

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

export type ColorByDimension = "git" | "heat" | "services" | "agents" | "group" | "none";

export const COLOR_BY_DIMENSIONS: ColorByDimension[] = [
  "git", "heat", "services", "agents", "group", "none",
];

/** `neutral` means "no signal in this dimension". The card needs it as a flag
 *  rather than comparing `bg` to `bg3`, because `bg` is a resolved hex by the
 *  time it reaches the DOM — a CSS attribute selector could never match it. */
export type BandColor = { bg: string; fg: string; neutral: boolean };
export type LegendEntry = { label: string; swatch: string };

const DAY = 86_400_000;

/** Distinct, sorted group names. Sorted so a group's hue never shifts when
 *  the project list reorders. */
export function groupsOf(projects: ProjectRow[]): string[] {
  const set = new Set<string>();
  for (const p of projects) if (p.group) set.add(p.group);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The five heat steps, hottest first. A single-hue sequential ramp off the
 *  theme accent — the correct form for ordered data. */
function heatRamp(theme: Theme): string[] {
  const { accent, bg, border } = theme.tokens;
  return [accent, mixHex(accent, bg, 70), mixHex(accent, bg, 45), mixHex(accent, bg, 25), border];
}

function chartHues(theme: Theme): string[] {
  const t = theme.tokens;
  return [t.chart1, t.chart2, t.chart3, t.chart4, t.chart5, t.chart6, t.chart7, t.chart8];
}

/** The hue for a project under a dimension, or null to mean "no signal". */
function hueFor(
  p: ProjectRow,
  dim: ColorByDimension,
  groups: string[],
  theme: Theme,
  now: number,
): string | null {
  const t = theme.tokens;
  if (dim === "none") return null;

  if (dim === "group") {
    if (!p.group) return null;
    const i = groups.indexOf(p.group);
    if (i < 0) return null;
    const hues = chartHues(theme);
    return hues[i % hues.length]!;
  }

  if (dim === "agents") return p.liveAgents.length > 0 ? t.info : null;

  // Every remaining dimension needs a snapshot.
  const snap = p.snapshot;
  if (!snap) return null;

  if (dim === "git") {
    if (snap.errors.length > 0) return t.error;
    if (snap.git.dirty) return t.warn;
    return t.ok;
  }

  if (dim === "services") {
    const running = snap.services.docker.some((d) => d.state === "running");
    const procs = snap.services.processes.length > 0;
    return running || procs ? t.ok : null;
  }

  // heat
  const activity = lastActivity(p);
  if (activity === 0) return null;
  const age = now - activity;
  const ramp = heatRamp(theme);
  if (age < DAY) return ramp[0]!;
  if (age < 7 * DAY) return ramp[1]!;
  if (age < 30 * DAY) return ramp[2]!;
  if (age < 90 * DAY) return ramp[3]!;
  return ramp[4]!;
}

/**
 * Band background + foreground for a project. The neutral ("no signal") band
 * goes through the identical readableOn path as a hue, which is what keeps the
 * 4.5:1 guarantee uniform — see the spec's §2.6 measurements.
 */
export function bandColor(
  p: ProjectRow,
  dim: ColorByDimension,
  groups: string[],
  theme: Theme,
  now: number,
): BandColor {
  const { bg, fg, bg3 } = theme.tokens;
  const hue = hueFor(p, dim, groups, theme, now);
  const surface = hue ?? bg3;
  // readableOn takes the two candidate neutrals as a named pair — three bare
  // hex strings made transposing `hue` with a candidate a silent failure.
  return { bg: surface, fg: readableOn(surface, { bg, fg }), neutral: hue === null };
}

export function legend(
  dim: ColorByDimension,
  groups: string[],
  theme: Theme,
): LegendEntry[] {
  const t = theme.tokens;
  switch (dim) {
    case "none":
      return [];
    case "git":
      return [
        { label: "clean", swatch: t.ok },
        { label: "dirty", swatch: t.warn },
        { label: "error", swatch: t.error },
        { label: "none", swatch: t.bg3 },
      ];
    case "heat": {
      const labels = ["today", "week", "month", "quarter", "older"];
      return heatRamp(theme).map((swatch, i) => ({ label: labels[i]!, swatch }));
    }
    case "services":
      return [
        { label: "running", swatch: t.ok },
        { label: "idle", swatch: t.bg3 },
      ];
    case "agents":
      return [
        { label: "agents", swatch: t.info },
        { label: "none", swatch: t.bg3 },
      ];
    case "group": {
      const hues = chartHues(theme);
      return [
        ...groups.map((g, i) => ({ label: g, swatch: hues[i % hues.length]! })),
        { label: "ungrouped", swatch: t.bg3 },
      ];
    }
  }
}
