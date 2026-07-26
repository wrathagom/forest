import { describe, expect, test } from "vitest";
import { THEMES } from "../src/lib/themes/index";
import { bandColor, groupsOf, legend, COLOR_BY_DIMENSIONS } from "../src/lib/colorBy";
import { contrast } from "../src/lib/contrast";
import type { ProjectRow } from "../src/api";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const GROUPS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]; // 9 — forces a cycle

/** One project per band state we can reach, so the sweep is exhaustive. */
function statesFor(): ProjectRow[] {
  const base: ProjectRow = {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: NOW, liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: NOW, services: { docker: [], processes: [] }, errors: [],
    },
  };
  const snap = base.snapshot!;
  const rows: ProjectRow[] = [
    base,                                                              // clean / hot
    { ...base, snapshot: null },                                       // neutral
    { ...base, snapshot: { ...snap, git: { ...snap.git, dirty: true } } },
    { ...base, snapshot: { ...snap, errors: ["boom"] } },
    { ...base, liveAgents: [{ agent: "claude", count: 1 }] },
    { ...base, snapshot: { ...snap, services: { docker: [{ name: "w", state: "running", from: "compose" }], processes: [] } } },
    // every heat bucket
    ...[0, 2, 10, 60, 200].map((d) => ({ ...base, snapshot: { ...snap, lastEdit: NOW - d * DAY } })),
    // every group hue, including the cycled one
    ...GROUPS.map((g) => ({ ...base, group: g })),
  ];
  return rows;
}

describe.each(THEMES.map((t) => [t.id, t] as const))("%s", (_id, theme) => {
  test("every reachable band clears 4.5:1", () => {
    for (const dim of COLOR_BY_DIMENSIONS) {
      for (const p of statesFor()) {
        const { bg, fg } = bandColor(p, dim, GROUPS, theme, NOW);
        const ratio = contrast(fg, bg);
        expect(
          ratio,
          `${theme.id} ${dim} band ${bg} on fg ${fg} = ${ratio.toFixed(3)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("the fixtures actually exercise every group hue", () => {
    // Guards the sweep above: if statesFor() stopped producing grouped rows,
    // the group hues would silently go untested.
    expect(groupsOf(statesFor())).toEqual(GROUPS);
  });

  test("every legend swatch is a 6-digit hex", () => {
    for (const dim of COLOR_BY_DIMENSIONS) {
      for (const entry of legend(dim, GROUPS, theme)) {
        expect(entry.swatch, `${theme.id} ${dim} ${entry.label}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

// Prints real numbers so a reviewer sees the margin rather than a silent pass.
test("band contrast report", () => {
  const rows = statesFor();
  const summary = THEMES.map((theme) => {
    let worst = Infinity;
    for (const dim of COLOR_BY_DIMENSIONS) {
      for (const p of rows) {
        const { bg, fg } = bandColor(p, dim, GROUPS, theme, NOW);
        worst = Math.min(worst, contrast(fg, bg));
      }
    }
    return { theme: theme.id, worstBand: +worst.toFixed(3) };
  });
  console.table(summary);
  expect(summary).toHaveLength(THEMES.length);
});
