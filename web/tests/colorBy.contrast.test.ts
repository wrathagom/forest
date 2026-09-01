import { describe, expect, test } from "vitest";
import { THEMES } from "../src/lib/themes/index";
import { bandColor, groupsOf, legend, COLOR_BY_DIMENSIONS } from "../src/lib/colorBy";
import { contrast } from "../src/lib/contrast";
import type { ProjectRow } from "../src/api";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const GROUPS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]; // 9 — forces a cycle

/**
 * One project per branch inside `hueFor`, not merely one per distinct color
 * it can currently produce. Some of these branches share a color today (a
 * live snapshot with zero activity and a `snapshot: null` project both land
 * on neutral `bg3`; a stopped-only docker fixture and a processes-only
 * fixture both land on the same `t.ok` as a running-docker fixture) — they
 * still get their own row so a future change that gives one of them a
 * distinct hue trips this sweep instead of running untested.
 */
function statesFor(): ProjectRow[] {
  const base: ProjectRow = {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: NOW, liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: NOW, services: { docker: [], processes: [] }, errors: [],
      lifecycle: { status: "none", hasConfig: false, enabled: false, health: null },
    },
  };
  const snap = base.snapshot!;
  const rows: ProjectRow[] = [
    base,                                                              // clean / hot
    { ...base, snapshot: null },                                       // neutral: no snapshot
    { ...base, snapshot: { ...snap, git: { ...snap.git, dirty: true } } },
    { ...base, snapshot: { ...snap, errors: ["boom"] } },
    { ...base, liveAgents: [{ agent: "claude", count: 1 }] },
    { ...base, snapshot: { ...snap, services: { docker: [{ name: "w", state: "running", from: "compose" }], processes: [] } } },
    // live snapshot but zero activity — distinct from `snapshot: null` above,
    // both land on neutral `bg3` but through different `hueFor` code paths
    { ...base, snapshot: { ...snap, lastEdit: null } },
    // docker present but every container stopped — distinct from the empty
    // `docker: []` default and from the running-container fixture above
    { ...base, snapshot: { ...snap, services: { docker: [{ name: "w", state: "stopped", from: "compose" }], processes: [] } } },
    // a live process with no docker at all — the other half of "services"
    { ...base, snapshot: { ...snap, services: { docker: [], processes: [{ pid: 1, command: "bun run dev", cwd: "/p", ports: [3000] }] } } },
    // a group name absent from the passed `groups` list — hits the
    // `indexOf` → -1 → null branch instead of a resolved chart hue
    { ...base, group: "not-in-groups" },
    // every heat bucket
    ...[0, 2, 10, 60, 200].map((d) => ({ ...base, snapshot: { ...snap, lastEdit: NOW - d * DAY } })),
    // every group hue, including the cycled one
    ...GROUPS.map((g) => ({ ...base, group: g })),
    // every lifecycle status branch inside hueFor's "lifecycle" switch
    ...(["healthy", "running", "errors", "starting", "stopping", "stopped"] as const).map((status) => ({
      ...base,
      snapshot: { ...snap, lifecycle: { status, hasConfig: true, enabled: true, health: null } },
    })),
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

  test("every legend swatch is a 6-digit hex", () => {
    for (const dim of COLOR_BY_DIMENSIONS) {
      for (const entry of legend(dim, GROUPS, theme)) {
        expect(entry.swatch, `${theme.id} ${dim} ${entry.label}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

// groupsOf() takes no theme, so this doesn't belong inside describe.each —
// it's a fixture-integrity check, not a per-theme one.
test("the fixtures actually exercise every group hue", () => {
  // Guards the sweep above: if statesFor() stopped producing grouped rows,
  // the group hues would silently go untested. Asserts a superset rather
  // than equality because the "not-in-groups" fixture (added to exercise
  // hueFor's out-of-band branch) deliberately adds an extra group name that
  // isn't one of the nine cycling hues.
  const found = groupsOf(statesFor());
  for (const g of GROUPS) {
    expect(found).toContain(g);
  }
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
