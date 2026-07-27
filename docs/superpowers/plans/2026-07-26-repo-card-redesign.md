# Repo Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's fixed project card with a colored title band whose hue is a user-picked dimension, three content presets, and a single actions menu — fixing two pre-existing alignment bugs along the way.

**Architecture:** All branching logic lives in two new pure modules (`lib/colorBy.ts`, `lib/dashboard-view.ts`) that take explicit `theme` and `now` arguments, so they unit-test without rendering or clock mocking. Components stay thin: `ProjectCard` composes a band + a body chosen by preset, and `CardMenu` owns the popover. No server changes.

**Tech Stack:** SolidJS, TypeScript, Vite, Vitest + `@solidjs/testing-library`, plain CSS custom properties. Runtime/package manager is Bun.

**Spec:** `docs/superpowers/specs/2026-07-26-repo-card-redesign-design.md`

---

## Conventions for every task

- Run web tests with `bun run test:web` from the repo root, or a single file with
  `cd web && bun run test -- tests/NAME.test.ts`.
- Test files live in `web/tests/`, flat (no subdirectories except `helpers/`).
- Component tests import from `@solidjs/testing-library`; `globals: true` is set
  in `web/vite.config.ts`, so `describe`/`test`/`expect` need no import, but the
  existing suite imports them explicitly from `vitest` — follow that.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `web/src/lib/contrast.ts` | create | WCAG luminance + contrast ratio. Moved out of the test helper so `src/` can use it. |
| `web/tests/helpers/contrast.ts` | rewrite | Re-export from `src/lib/contrast.ts`. One implementation. |
| `web/src/lib/colorBy.ts` | create | The six color-by dimensions, band colors, legend. Pure. |
| `web/src/lib/dashboard-view.ts` | create | Preset definitions, chip/row derivation, `relativeAge`. Pure. |
| `web/src/lib/preferences.ts` | modify | Add `dashboardPreset` + `dashboardColorBy` signals. |
| `web/src/lib/project-list.ts` | modify | `searchProjects` sorts pinned first. |
| `web/src/components/CardMenu.tsx` | create | `☰` button + click-outside popover. |
| `web/src/components/DashboardToolbar.tsx` | create | Search, sort, preset control, color-by, legend. Extracted from `Dashboard.tsx` so it is testable without the projects resource. |
| `web/src/components/ProjectCard.tsx` | rewrite | Band, right cluster, body per preset. |
| `web/src/components/ProjectGrid.tsx` | modify | Thread preset + color-by to cards. |
| `web/src/components/ServiceList.tsx` | delete | Only consumer was `ProjectCard`. |
| `web/src/pages/Dashboard.tsx` | modify | Preset control, color-by select, legend. |
| `web/src/pages/Archives.tsx` | modify | **Second `ProjectGrid` consumer, missed in planning.** Must pass the new required props or every archived card renders an empty body. |
| `web/src/styles.css` | modify | `--control-h`, `--icon-btn`, band, chips, equal-height flex, toolbar fix. |
| `README.md` | modify | Document the presets and color-by. |

Tasks 1–6 are pure logic and independent of each other after Task 1. Tasks 7–9
are components. Task 10 is CSS. Tasks 11–12 are cleanup and docs.

---

### Task 1: Extract the contrast helper into `src/`

`colorBy.ts` needs `contrast()`, which currently exists only under `web/tests/`.
Move the implementation and leave the test helper re-exporting it, so the 16-theme
catalog test keeps working untouched.

**Files:**
- Create: `web/src/lib/contrast.ts`
- Rewrite: `web/tests/helpers/contrast.ts`
- Test: `web/tests/contrast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/contrast.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { contrast, luminance, parseHex, mixHex } from "../src/lib/contrast";

describe("parseHex", () => {
  test("parses a 6-digit hex", () => {
    expect(parseHex("#ff8000")).toEqual([255, 128, 0]);
  });

  test("throws on anything else", () => {
    expect(() => parseHex("#fff")).toThrow();
  });
});

describe("luminance", () => {
  test("black is 0 and white is 1", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrast", () => {
  test("black on white is 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  test("is symmetric", () => {
    expect(contrast("#ff5555", "#282a36")).toBeCloseTo(contrast("#282a36", "#ff5555"), 6);
  });

  test("a color against itself is 1:1", () => {
    expect(contrast("#6ee7b7", "#6ee7b7")).toBeCloseTo(1, 6);
  });
});

describe("mixHex", () => {
  test("100% of a is a, 0% is b", () => {
    expect(mixHex("#ffffff", "#000000", 100)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#000000", 0)).toBe("#000000");
  });

  test("50% of white and black is mid grey", () => {
    expect(mixHex("#ffffff", "#000000", 50)).toBe("#808080");
  });

  test("clamps out-of-range percentages", () => {
    expect(mixHex("#ffffff", "#000000", 150)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#000000", -20)).toBe("#000000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/contrast.test.ts`
Expected: FAIL — cannot resolve `../src/lib/contrast`.

- [ ] **Step 3: Create `web/src/lib/contrast.ts`**

```ts
// WCAG 2.1 relative luminance and contrast ratio, plus hex mixing.
// Lives in src/ (not tests/) because colorBy.ts derives band foregrounds
// from real contrast ratios at runtime.

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Mix two hex colors in sRGB. `pctA` is how much of `a` to keep (0-100).
 * Numeric rather than CSS `color-mix()` because the result has to be fed back
 * into a contrast calculation, which CSS cannot do.
 */
export function mixHex(a: string, b: string, pctA: number): string {
  const t = Math.max(0, Math.min(100, pctA)) / 100;
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t));
}
```

- [ ] **Step 4: Rewrite `web/tests/helpers/contrast.ts` to re-export**

```ts
// web/tests/helpers/contrast.ts
// The implementation moved to src/lib/contrast.ts so runtime code can use it.
// Re-exported here so existing theme tests keep their import path.
export { parseHex, luminance, contrast, mixHex } from "../../src/lib/contrast";
```

- [ ] **Step 5: Run the new test and the whole suite**

Run: `cd web && bun run test -- tests/contrast.test.ts`
Expected: PASS (9 tests).

Run: `bun run test:web`
Expected: PASS — in particular `theme-catalog.test.ts`, which imports the helper,
must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/contrast.ts web/tests/helpers/contrast.ts web/tests/contrast.test.ts
git commit -m "refactor(contrast): move WCAG helpers into src so runtime can use them"
```

---

### Task 2: `readableOn` — the band foreground rule

The rule from spec §2.1: prefer the theme's own `bg`/`fg` if it clears 4.5:1,
otherwise absolute black or white. The fallback is provably ≥4.58:1 for any hue.

**Files:**
- Create: `web/src/lib/colorBy.ts`
- Test: `web/tests/colorBy.readableOn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/colorBy.readableOn.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { readableOn } from "../src/lib/colorBy";
import { contrast } from "../src/lib/contrast";

// A dark theme's neutrals and a light theme's neutrals.
const DARK = { bg: "#0e0e10", fg: "#e6e6e6" };
const LIGHT = { bg: "#fdf6e3", fg: "#657b83" };

describe("readableOn", () => {
  test("picks a theme-native tone when one clears 4.5:1", () => {
    // #f59e0b (amber) against a near-black bg is ~8.7:1.
    expect(readableOn("#f59e0b", DARK)).toBe(DARK.bg);
  });

  test("falls back to absolute black when neither native tone clears", () => {
    // Solarized Light: neither #fdf6e3 nor #657b83 clears 4.5:1 on its own bg3.
    const out = readableOn("#eee8d5", LIGHT);
    expect(out).toBe("#000000");
  });

  test("falls back to white when both native tones miss and the hue sits under the crossover", () => {
    // #6c6c6c has L≈0.150, just below the 0.179 crossover. Against DARK,
    // bg is 3.67:1 and fg is 4.21:1 — both miss the floor — and white
    // (5.25:1) beats black (4.00:1).
    expect(readableOn("#6c6c6c", DARK)).toBe("#ffffff");
  });

  test("falls back to black when the hue sits just above the crossover", () => {
    // #767676, L≈0.181. bg 4.25:1 and fg 3.64:1 both miss; now black
    // (4.62:1) edges out white (4.54:1). The mirror of the test above.
    expect(readableOn("#767676", DARK)).toBe("#000000");
  });

  test("falls back to white in a light theme too", () => {
    // #747474, L≈0.175. LIGHT.bg is 4.33:1 and LIGHT.fg only 1.05:1, so both
    // miss; white wins at 4.67:1 over black's 4.49:1.
    expect(readableOn("#747474", LIGHT)).toBe("#ffffff");
  });

  test("always clears 4.5:1, even at the black/white crossover luminance", () => {
    // L ~= 0.179 is where black and white are equally bad (both 4.58:1).
    for (const hue of ["#767676", "#7a7a7a", "#808080", "#6f6f6f"]) {
      const fg = readableOn(hue, DARK);
      expect(contrast(fg, hue), `${hue} -> ${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("is deterministic", () => {
    expect(readableOn("#6ee7b7", DARK)).toBe(
      readableOn("#6ee7b7", DARK),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/colorBy.readableOn.test.ts`
Expected: FAIL — cannot resolve `../src/lib/colorBy`.

- [ ] **Step 3: Create `web/src/lib/colorBy.ts` with just `readableOn`**

```ts
import { contrast } from "./contrast";

/** WCAG AA for normal-size text. The card title is 13px semibold, which is
 *  below the 18.66px "large text" threshold, so 4.5 applies rather than 3.0. */
const FLOOR = 4.5;

/**
 * Pick a readable foreground for text sitting on `hue`.
 *
 * Prefers one of the theme's own neutrals so the band stays theme-flavored,
 * and only falls back to absolute black/white when neither clears the floor.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- tests/colorBy.readableOn.test.ts`
Expected: PASS (7 tests).

> **Corrected during execution.** This step originally asserted
> `readableOn("#101014", LIGHT.bg, LIGHT.fg) === "#ffffff"`, which is
> unsatisfiable: a light theme's near-white `bg` scores ~17.6:1 against a
> near-black hue, so it clears the floor and the fallback branch is never
> reached. The white fallback is only reachable in the L ≈ 0.138–0.178 band just
> under the 0.179 crossover — under DARK for greys `#686868`–`#757575`, under
> LIGHT for `#727272`–`#757575`. The three replacement tests above cover white
> fallback, black fallback, and light-theme fallback with measured values.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/colorBy.ts web/tests/colorBy.readableOn.test.ts
git commit -m "feat(colorBy): derive a readable band foreground for any hue"
```

---

### Task 3: The six color-by dimensions

**Files:**
- Modify: `web/src/lib/colorBy.ts`
- Test: `web/tests/colorBy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/colorBy.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { bandColor, groupsOf, legend, COLOR_BY_DIMENSIONS } from "../src/lib/colorBy";
import type { ProjectRow } from "../src/api";
import { THEME_BY_ID } from "../src/lib/themes/index";

const theme = THEME_BY_ID["forest-dark"]!;
const k = theme.tokens;
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: NOW, liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: NOW, services: { docker: [], processes: [] }, errors: [],
    },
    ...over,
  };
}

describe("COLOR_BY_DIMENSIONS", () => {
  test("exposes all six in order, git first", () => {
    expect(COLOR_BY_DIMENSIONS).toEqual(["git", "heat", "services", "agents", "group", "none"]);
  });
});

describe("bandColor — git", () => {
  test("clean is ok", () => {
    expect(bandColor(project(), "git", [], theme, NOW).bg).toBe(k.ok);
  });

  test("dirty is warn", () => {
    const p = project({ snapshot: { ...project().snapshot!, git: { ...project().snapshot!.git, dirty: true, changed: 3 } } });
    expect(bandColor(p, "git", [], theme, NOW).bg).toBe(k.warn);
  });

  test("errors outrank dirty", () => {
    const p = project({ snapshot: { ...project().snapshot!, git: { ...project().snapshot!.git, dirty: true }, errors: ["docker down"] } });
    expect(bandColor(p, "git", [], theme, NOW).bg).toBe(k.error);
  });

  test("no snapshot is neutral", () => {
    expect(bandColor(project({ snapshot: null }), "git", [], theme, NOW).bg).toBe(k.bg3);
  });
});

describe("bandColor — heat", () => {
  const at = (ms: number) =>
    project({ snapshot: { ...project().snapshot!, lastEdit: ms } });

  test("today is the full accent", () => {
    expect(bandColor(at(NOW - 3_600_000), "heat", [], theme, NOW).bg).toBe(k.accent);
  });

  test("buckets get progressively colder", () => {
    const bands = [2, 10, 60, 200].map((d) => bandColor(at(NOW - d * DAY), "heat", [], theme, NOW).bg);
    expect(new Set(bands).size).toBe(4);
    expect(bands[3]).toBe(k.border);
  });

  test("an age exactly on a boundary falls into the older bucket", () => {
    // exactly 24h old is "this week", not "today" — the test is `age < DAY`.
    expect(bandColor(at(NOW - DAY), "heat", [], theme, NOW).bg).not.toBe(k.accent);
  });

  test("never scanned is neutral, not the coldest step", () => {
    expect(bandColor(project({ snapshot: null }), "heat", [], theme, NOW).bg).toBe(k.bg3);
  });
});

describe("bandColor — services and agents", () => {
  test("a running container is ok", () => {
    const p = project({ snapshot: { ...project().snapshot!, services: { docker: [{ name: "web", state: "running", from: "compose" }], processes: [] } } });
    expect(bandColor(p, "services", [], theme, NOW).bg).toBe(k.ok);
  });

  test("only stopped containers is neutral", () => {
    const p = project({ snapshot: { ...project().snapshot!, services: { docker: [{ name: "web", state: "stopped", from: "compose" }], processes: [] } } });
    expect(bandColor(p, "services", [], theme, NOW).bg).toBe(k.bg3);
  });

  test("a listening process is ok", () => {
    const p = project({ snapshot: { ...project().snapshot!, services: { docker: [], processes: [{ pid: 1, command: "vite", cwd: "/p", ports: [5173] }] } } });
    expect(bandColor(p, "services", [], theme, NOW).bg).toBe(k.ok);
  });

  test("live agents are info", () => {
    const p = project({ liveAgents: [{ agent: "claude", count: 2 }] });
    expect(bandColor(p, "agents", [], theme, NOW).bg).toBe(k.info);
  });

  test("no agents is neutral", () => {
    expect(bandColor(project(), "agents", [], theme, NOW).bg).toBe(k.bg3);
  });
});

describe("bandColor — group", () => {
  const groups = ["Personal", "Work", "oss"];

  test("each group gets a distinct chart hue", () => {
    const seen = groups.map((g) => bandColor(project({ group: g }), "group", groups, theme, NOW).bg);
    expect(new Set(seen).size).toBe(3);
  });

  test("the same group is stable across calls", () => {
    const a = bandColor(project({ group: "Work" }), "group", groups, theme, NOW).bg;
    const b = bandColor(project({ group: "Work" }), "group", groups, theme, NOW).bg;
    expect(a).toBe(b);
  });

  test("ungrouped is neutral", () => {
    expect(bandColor(project({ group: null }), "group", groups, theme, NOW).bg).toBe(k.bg3);
  });

  test("cycles past 8 groups rather than running out", () => {
    const many = Array.from({ length: 10 }, (_, i) => `g${i}`);
    const first = bandColor(project({ group: "g0" }), "group", many, theme, NOW).bg;
    const ninth = bandColor(project({ group: "g8" }), "group", many, theme, NOW).bg;
    expect(ninth).toBe(first);
  });

  test("a group absent from the list is neutral", () => {
    expect(bandColor(project({ group: "Nope" }), "group", groups, theme, NOW).bg).toBe(k.bg3);
  });
});

describe("bandColor — none", () => {
  test("is always neutral regardless of state", () => {
    const p = project({ snapshot: { ...project().snapshot!, errors: ["boom"] } });
    expect(bandColor(p, "none", [], theme, NOW).bg).toBe(k.bg3);
  });
});

describe("bandColor — the neutral flag", () => {
  test("is true whenever there is no signal", () => {
    expect(bandColor(project(), "none", [], theme, NOW).neutral).toBe(true);
    expect(bandColor(project({ snapshot: null }), "git", [], theme, NOW).neutral).toBe(true);
    expect(bandColor(project({ group: null }), "group", ["a"], theme, NOW).neutral).toBe(true);
    expect(bandColor(project(), "agents", [], theme, NOW).neutral).toBe(true);
  });

  test("is false when the dimension resolved a hue", () => {
    expect(bandColor(project(), "git", [], theme, NOW).neutral).toBe(false);
    expect(bandColor(project({ group: "a" }), "group", ["a"], theme, NOW).neutral).toBe(false);
  });

  test("a heat band that lands on the coldest step is a real signal, not neutral", () => {
    const cold = project({ snapshot: { ...project().snapshot!, lastEdit: NOW - 400 * DAY } });
    const band = bandColor(cold, "heat", [], theme, NOW);
    expect(band.bg).toBe(k.border);
    expect(band.neutral).toBe(false);
  });
});

describe("groupsOf", () => {
  test("returns distinct non-null groups, sorted, for stability", () => {
    const rows = [project({ group: "Work" }), project({ group: null }), project({ group: "Personal" }), project({ group: "Work" })];
    expect(groupsOf(rows)).toEqual(["Personal", "Work"]);
  });
});

describe("legend", () => {
  test("git lists its four states", () => {
    expect(legend("git", [], theme).map((e) => e.label)).toEqual(["clean", "dirty", "error", "none"]);
  });

  test("none has no legend entries", () => {
    expect(legend("none", [], theme)).toEqual([]);
  });

  test("group lists each group plus ungrouped", () => {
    expect(legend("group", ["Personal", "Work"], theme).map((e) => e.label))
      .toEqual(["Personal", "Work", "ungrouped"]);
  });

  test("heat lists its five buckets", () => {
    expect(legend("heat", [], theme)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/colorBy.test.ts`
Expected: FAIL — `bandColor` is not exported.

- [ ] **Step 3: Append to `web/src/lib/colorBy.ts`**

Add below `readableOn`:

```ts
import type { ProjectRow } from "../api";
import type { Theme } from "./themes/types";
import { mixHex } from "./contrast";
import { lastActivity } from "./project-list";

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
```

Move the two `import` lines to the top of the file alongside the existing
`import { contrast } from "./contrast";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- tests/colorBy.test.ts`
Expected: PASS (28 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/colorBy.ts web/tests/colorBy.test.ts
git commit -m "feat(colorBy): add the six color-by dimensions and legend"
```

---

### Task 4: The 16-theme band contrast floor

This is the test that makes Task 2's rule safe to rely on. Verified numbers: the
worst hue pair is 4.532:1 (`dracula.error`) and the worst neutral is 4.581:1
(`one-dark`), so a 4.5 floor passes with a thin margin.

**Files:**
- Test: `web/tests/colorBy.contrast.test.ts`

- [ ] **Step 1: Write the test (it should pass immediately — it guards Task 2)**

Create `web/tests/colorBy.contrast.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `cd web && bun run test -- tests/colorBy.contrast.test.ts`
Expected: PASS (49 tests — 3 per theme plus the report). The report table prints a
`worstBand` per theme; the lowest value across all 16 should be **~4.53**
(`dracula`). If it prints materially lower, `readableOn` regressed.

If any theme FAILS here, do **not** lower the floor — the bug is in `readableOn`.

- [ ] **Step 3: Commit**

```bash
git add web/tests/colorBy.contrast.test.ts
git commit -m "test(colorBy): floor every band pair at 4.5:1 across all 16 themes"
```

---

### Task 5: `dashboard-view` — relative age and the chip vocabulary

**Files:**
- Create: `web/src/lib/dashboard-view.ts`
- Test: `web/tests/dashboard-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/dashboard-view.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  relativeAge, statusChips, compactLine, detailRows, VIEW_PRESETS,
} from "../src/lib/dashboard-view";
import type { ProjectRow } from "../src/api";

const NOW = 1_700_000_000_000;
const SEC = 1000, MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: NOW, liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: NOW, services: { docker: [], processes: [] }, errors: [],
    },
    ...over,
  };
}
const withGit = (g: Partial<ProjectRow["snapshot"]["git"]>) => {
  const base = project().snapshot!;
  return project({ snapshot: { ...base, git: { ...base.git, ...g } } });
};
const labels = (p: ProjectRow) => statusChips(p, NOW).map((c) => c.label);

describe("VIEW_PRESETS", () => {
  test("exposes the three presets in density order", () => {
    expect(VIEW_PRESETS).toEqual(["compact", "status", "detail"]);
  });
});

describe("relativeAge", () => {
  test("formats each bucket compactly", () => {
    expect(relativeAge(NOW - 30 * SEC, NOW)).toBe("30s");
    expect(relativeAge(NOW - 3 * MIN, NOW)).toBe("3m");
    expect(relativeAge(NOW - 6 * HOUR, NOW)).toBe("6h");
    expect(relativeAge(NOW - 2 * DAY, NOW)).toBe("2d");
    expect(relativeAge(NOW - 14 * DAY, NOW)).toBe("2w");
    expect(relativeAge(NOW - 120 * DAY, NOW)).toBe("4mo");
    expect(relativeAge(NOW - 800 * DAY, NOW)).toBe("2y");
  });

  test("distinguishes minutes from months", () => {
    expect(relativeAge(NOW - 4 * MIN, NOW)).toBe("4m");
    expect(relativeAge(NOW - 100 * DAY, NOW)).toBe("3mo");
  });

  test("null renders an em dash", () => {
    expect(relativeAge(null, NOW)).toBe("—");
  });

  test("a future timestamp clamps to 0s rather than going negative", () => {
    expect(relativeAge(NOW + 5 * MIN, NOW)).toBe("0s");
  });
});

describe("statusChips", () => {
  test("emits no clean chip for a clean tree", () => {
    expect(labels(project())).not.toContain("clean");
  });

  test("dirty shows +N", () => {
    expect(labels(withGit({ dirty: true, changed: 4 }))).toContain("+4");
  });

  test("ahead and behind show arrows only when non-zero", () => {
    expect(labels(withGit({ ahead: 2, behind: 0 }))).toContain("↑2");
    expect(labels(withGit({ ahead: 0, behind: 7 }))).toContain("↓7");
    expect(labels(project())).not.toContain("↑0");
  });

  test("container counts are worded, not glyphed", () => {
    const base = project().snapshot!;
    const p = project({ snapshot: { ...base, services: {
      docker: [
        { name: "a", state: "running", from: "compose" },
        { name: "b", state: "stopped", from: "compose" },
        { name: "c", state: "stopped", from: "compose" },
      ], processes: [] } } });
    expect(labels(p)).toContain("1 running");
    expect(labels(p)).toContain("2 stopped");
  });

  test("process count is singular at one", () => {
    const base = project().snapshot!;
    const one = project({ snapshot: { ...base, services: { docker: [], processes: [{ pid: 1, command: "vite", cwd: "/p", ports: [] }] } } });
    expect(labels(one)).toContain("1 process");
  });

  test("ports are one chip each, distinct and sorted", () => {
    const base = project().snapshot!;
    const p = project({ snapshot: { ...base, services: { docker: [], processes: [
      { pid: 1, command: "vite", cwd: "/p", ports: [5173, 3000] },
      { pid: 2, command: "bun", cwd: "/p", ports: [3000, 52810] },
    ] } } });
    const ports = labels(p).filter((l) => l.startsWith(":"));
    expect(ports).toEqual([":3000", ":5173", ":52810"]);
  });

  test("terminals and agents each get a chip", () => {
    expect(labels(project({ liveSessions: 2 }))).toContain("2 terminals");
    expect(labels(project({ liveSessions: 1 }))).toContain("1 terminal");
    expect(labels(project({ liveAgents: [{ agent: "claude", count: 2 }] }))).toContain("🤖 2");
  });

  test("agent counts sum across agents", () => {
    const p = project({ liveAgents: [{ agent: "claude", count: 2 }, { agent: "codex", count: 1 }] });
    expect(labels(p)).toContain("🤖 3");
  });

  test("age is the last chip and renders bare", () => {
    const out = statusChips(project({ liveSessions: 1 }), NOW);
    expect(out[out.length - 1]!.tone).toBe("bare");
  });

  test("no snapshot yields only the age chip", () => {
    expect(labels(project({ snapshot: null }))).toEqual(["—"]);
  });

  test("chip keys are unique so <For> can key on them", () => {
    const base = project().snapshot!;
    const p = project({ liveSessions: 1, liveAgents: [{ agent: "c", count: 1 }],
      snapshot: { ...base, git: { ...base.git, dirty: true, changed: 2, ahead: 1, behind: 1 },
        services: { docker: [], processes: [{ pid: 1, command: "v", cwd: "/p", ports: [1, 2] }] } } });
    const keys = statusChips(p, NOW).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("compactLine", () => {
  test("joins branch, git summary and age", () => {
    expect(compactLine(project(), NOW)).toBe("main · clean · 0s");
  });

  test("shows the change count when dirty", () => {
    expect(compactLine(withGit({ dirty: true, changed: 4 }), NOW)).toBe("main · +4 · 0s");
  });

  test("detached when there is no branch", () => {
    expect(compactLine(withGit({ branch: null }), NOW)).toContain("detached");
  });

  test("says so when never scanned", () => {
    expect(compactLine(project({ snapshot: null }), NOW)).toBe("not scanned yet");
  });
});

describe("detailRows", () => {
  test("labels branch, commit, edited and run", () => {
    const base = project().snapshot!;
    const p = project({ snapshot: { ...base,
      git: { ...base.git, lastCommit: { sha: "abc", message: "fix: a thing", timestamp: NOW - HOUR } },
      lastEdit: NOW - MIN,
      services: { docker: [{ name: "web", state: "running", from: "compose" }],
                  processes: [{ pid: 1, command: "vite", cwd: "/p", ports: [5173] }] } } });
    const rows = detailRows(p, NOW);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["branch"]).toContain("main");
    expect(byLabel["commit"]).toBe("1h · fix: a thing");
    expect(byLabel["edited"]).toBe("1m");
    expect(byLabel["run"]).toContain("vite :5173");
    expect(byLabel["run"]).toContain("web");
  });

  test("omits the commit row when there is no commit", () => {
    expect(detailRows(project(), NOW).map((r) => r.label)).not.toContain("commit");
  });

  test("surfaces errors as their own row", () => {
    const base = project().snapshot!;
    const p = project({ snapshot: { ...base, errors: ["docker unreachable", "git failed"] } });
    const issue = detailRows(p, NOW).find((r) => r.label === "issues");
    expect(issue?.value).toBe("docker unreachable · git failed");
  });

  test("is empty when never scanned", () => {
    expect(detailRows(project({ snapshot: null }), NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/dashboard-view.test.ts`
Expected: FAIL — cannot resolve `../src/lib/dashboard-view`.

- [ ] **Step 3: Create `web/src/lib/dashboard-view.ts`**

```ts
import type { ProjectRow } from "../api";
import { lastActivity } from "./project-list";

export type ViewPreset = "compact" | "status" | "detail";

/** Density order, least to most. Drives the toolbar's segmented control. */
export const VIEW_PRESETS: ViewPreset[] = ["compact", "status", "detail"];

/** `bare` renders borderless and unlabelled — used only for the age chip. */
export type ChipTone =
  | "neutral" | "dirty" | "ahead" | "behind" | "running" | "agent" | "bare";

export type Chip = { key: string; label: string; tone: ChipTone; title?: string };
export type DetailRow = { label: string; value: string };

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/**
 * Compact relative age: `30s` `3m` `6h` `2d` `2w` `4mo` `2y`.
 * `m` is minutes and `mo` is months — deliberately distinct.
 * `now` is a parameter rather than `Date.now()` so this is testable.
 */
export function relativeAge(ms: number | null, now: number): string {
  if (ms === null || ms === 0) return "—";
  const d = Math.max(0, now - ms);
  if (d < MIN) return `${Math.floor(d / 1000)}s`;
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 30 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  if (d < 365 * DAY) return `${Math.floor(d / (30 * DAY))}mo`;
  return `${Math.floor(d / (365 * DAY))}y`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function distinctPorts(p: ProjectRow): number[] {
  const set = new Set<number>();
  for (const proc of p.snapshot?.services.processes ?? []) {
    for (const port of proc.ports) set.add(port);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The `status` preset's chip row, in a fixed order so the eye learns positions.
 * A chip is omitted entirely when its value is zero or absent — that omission
 * is the signal. There is deliberately no `clean` chip: the absence of `+N`
 * already carries it.
 */
export function statusChips(p: ProjectRow, now: number): Chip[] {
  const chips: Chip[] = [];
  const snap = p.snapshot;

  if (snap) {
    const g = snap.git;
    if (g.dirty) {
      chips.push({ key: "dirty", label: `+${g.changed}`, tone: "dirty",
                   title: `${g.changed} changed file(s)` });
    }
    if (g.ahead > 0) {
      chips.push({ key: "ahead", label: `↑${g.ahead}`, tone: "ahead",
                   title: "commits ahead of upstream" });
    }
    if (g.behind > 0) {
      chips.push({ key: "behind", label: `↓${g.behind}`, tone: "behind",
                   title: "commits behind upstream" });
    }

    const running = snap.services.docker.filter((d) => d.state === "running").length;
    const stopped = snap.services.docker.filter((d) => d.state === "stopped").length;
    if (running > 0) chips.push({ key: "running", label: `${running} running`, tone: "running" });
    if (stopped > 0) chips.push({ key: "stopped", label: `${stopped} stopped`, tone: "neutral" });

    const procs = snap.services.processes.length;
    if (procs > 0) {
      chips.push({ key: "procs", label: plural(procs, "process", "processes"), tone: "neutral" });
    }
  }

  if (p.liveSessions > 0) {
    chips.push({ key: "terms", label: plural(p.liveSessions, "terminal", "terminals"),
                 tone: "neutral", title: "open terminals in forest" });
  }

  for (const port of distinctPorts(p)) {
    chips.push({ key: `port-${port}`, label: `:${port}`, tone: "neutral" });
  }

  if (p.liveAgents.length > 0) {
    const total = p.liveAgents.reduce((n, a) => n + a.count, 0);
    chips.push({
      key: "agents", label: `🤖 ${total}`, tone: "agent",
      title: p.liveAgents.map((a) => `${a.count} ${a.agent}`).join(", "),
    });
  }

  // Always last, and always bare.
  chips.push({ key: "age", label: relativeAge(lastActivity(p) || null, now), tone: "bare" });
  return chips;
}

/** The `compact` preset's single dim line. */
export function compactLine(p: ProjectRow, now: number): string {
  const snap = p.snapshot;
  if (!snap) return "not scanned yet";
  const branch = snap.git.branch ?? "detached";
  const git = snap.git.dirty ? `+${snap.git.changed}` : "clean";
  return `${branch} · ${git} · ${relativeAge(lastActivity(p) || null, now)}`;
}

/** The `detail` preset's labelled rows. Rows with nothing to say are omitted. */
export function detailRows(p: ProjectRow, now: number): DetailRow[] {
  const snap = p.snapshot;
  if (!snap) return [];
  const rows: DetailRow[] = [];
  const g = snap.git;

  const bits = [g.branch ?? "detached"];
  if (g.dirty) bits.push(`+${g.changed}`);
  if (g.ahead > 0) bits.push(`↑${g.ahead}`);
  if (g.behind > 0) bits.push(`↓${g.behind}`);
  if (!g.dirty) bits.push("clean");
  rows.push({ label: "branch", value: bits.join(" ") });

  if (g.lastCommit) {
    rows.push({
      label: "commit",
      value: `${relativeAge(g.lastCommit.timestamp, now)} · ${g.lastCommit.message}`,
    });
  }
  if (snap.lastEdit) {
    rows.push({ label: "edited", value: relativeAge(snap.lastEdit, now) });
  }

  const named = [
    ...snap.services.processes.map((proc) =>
      proc.ports.length ? `${proc.command} ${proc.ports.map((n) => `:${n}`).join(" ")}` : proc.command),
    ...snap.services.docker.filter((d) => d.state === "running").map((d) => d.name),
    ...snap.services.docker.filter((d) => d.state === "stopped").map((d) => d.name),
  ];
  if (named.length > 0) rows.push({ label: "run", value: named.join(" · ") });

  if (snap.errors.length > 0) {
    rows.push({ label: "issues", value: snap.errors.join(" · ") });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- tests/dashboard-view.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/dashboard-view.ts web/tests/dashboard-view.test.ts
git commit -m "feat(dashboard-view): derive card chips and rows per view preset"
```

---

### Task 6: Preferences and pinned-first search

Two small independent edits, committed together because neither is worth its own
commit.

**Files:**
- Modify: `web/src/lib/preferences.ts`
- Modify: `web/src/lib/project-list.ts:36-44`
- Test: `web/tests/project-list.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to the end of `web/tests/project-list.test.ts`. That file already has a
`proj({ name })` factory (which sets `id` from `name`) and already imports
`searchProjects` — reuse both rather than adding duplicates.

```ts
describe("searchProjects — pinned first", () => {
  test("hoists pinned matches above unpinned ones", () => {
    const out = searchProjects(
      [proj({ name: "alpha" }), proj({ name: "alpha-two", pinned: true })],
      [],
      "alpha",
      "name",
    );
    expect(out.map((p) => p.name)).toEqual(["alpha-two", "alpha"]);
  });

  test("applies the chosen sort within the pinned and unpinned partitions", () => {
    const out = searchProjects(
      [
        proj({ name: "zeta", pinned: true }),
        proj({ name: "alpha", pinned: true }),
        proj({ name: "yankee" }),
        proj({ name: "bravo" }),
      ],
      [],
      "",
      "name",
    );
    expect(out.map((p) => p.name)).toEqual(["alpha", "zeta", "bravo", "yankee"]);
  });

  test("still merges archived results", () => {
    const out = searchProjects(
      [proj({ name: "match-visible" })],
      [proj({ name: "match-archived" })],
      "match",
      "name",
    );
    expect(out.map((p) => p.name).sort()).toEqual(["match-archived", "match-visible"]);
  });

  test("a pinned archived project still sorts first", () => {
    const out = searchProjects(
      [proj({ name: "match-a" })],
      [proj({ name: "match-b", pinned: true })],
      "match",
      "name",
    );
    expect(out[0]!.name).toBe("match-b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/project-list.test.ts`
Expected: FAIL — three of the four new tests fail, because ordering ignores `pinned`.
("still merges archived results" already passes.)

- [ ] **Step 3: Change `searchProjects` in `web/src/lib/project-list.ts`**

Replace the body:

```ts
/**
 * Merge visible + archived, keep name matches, and sort. Used while searching.
 *
 * Pinned projects sort first. The default dashboard view renders pinned in its
 * own section, so position is what conveys "pinned" now that the card has no
 * star; partitioning here keeps that true in search results too.
 */
export function searchProjects(
  visible: ProjectRow[],
  archived: ProjectRow[],
  query: string,
  sort: ProjectSort,
): ProjectRow[] {
  const merged = [...visible, ...archived].filter((p) => matchesQuery(p, query));
  const pinned = sortProjects(merged.filter((p) => p.pinned), sort);
  const rest = sortProjects(merged.filter((p) => !p.pinned), sort);
  return [...pinned, ...rest];
}
```

- [ ] **Step 4: Add the preference signals to `web/src/lib/preferences.ts`**

Append:

```ts
import type { ViewPreset } from "./dashboard-view";
import type { ColorByDimension } from "./colorBy";

export const [dashboardPreset, setDashboardPreset] = persistedSignal<ViewPreset>(
  "dashboard.preset",
  "status",
);

export const [dashboardColorBy, setDashboardColorBy] = persistedSignal<ColorByDimension>(
  "dashboard.colorBy",
  "git",
);
```

- [ ] **Step 5: Run the suite**

Run: `bun run test:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/preferences.ts web/src/lib/project-list.ts web/tests/project-list.test.ts
git commit -m "feat(dashboard): persist preset + color-by, sort pinned first in search"
```

---

### Task 7: `CardMenu`

**Files:**
- Create: `web/src/components/CardMenu.tsx`
- Test: `web/tests/CardMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/tests/CardMenu.test.tsx`:

```tsx
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import CardMenu from "../src/components/CardMenu";

type Props = {
  pinned: boolean; hidden: boolean;
  onOpen: () => void; onRefresh: () => void; onCopyPath: () => void;
  onTogglePin: () => void; onToggleArchive: () => void;
};

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    pinned: false, hidden: false,
    onOpen: vi.fn(), onRefresh: vi.fn(), onCopyPath: vi.fn(),
    onTogglePin: vi.fn(), onToggleArchive: vi.fn(),
    ...over,
  };
  const utils = render(() => <CardMenu {...props} />);
  const open = () =>
    fireEvent.click(utils.container.querySelector(".card-menu-trigger") as HTMLElement);
  return { ...utils, props, open };
}

describe("CardMenu", () => {
  test("renders a single always-visible trigger", () => {
    const { container } = setup();
    expect(container.querySelectorAll(".card-menu-trigger")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /more/i })).toBeTruthy();
  });

  test("the menu is closed until the trigger is clicked", () => {
    const { open, queryByText, getByText } = setup();
    expect(queryByText("refresh")).toBeNull();
    open();
    expect(getByText("refresh")).toBeTruthy();
  });

  test("the trigger toggles rather than only opening", () => {
    const { open, queryByText } = setup();
    open();
    expect(queryByText("refresh")).toBeTruthy();
    open();
    expect(queryByText("refresh")).toBeNull();
  });

  test("shows pin for an unpinned project and unpin for a pinned one", () => {
    const a = setup({ pinned: false });
    a.open();
    expect(a.getByText("pin")).toBeTruthy();
    a.unmount();

    const b = setup({ pinned: true });
    b.open();
    expect(b.getByText("unpin")).toBeTruthy();
  });

  test("shows restore instead of archive when hidden", () => {
    const { open, getByText, queryByText } = setup({ hidden: true });
    open();
    expect(getByText("restore")).toBeTruthy();
    expect(queryByText("archive")).toBeNull();
  });

  test("omits pin entirely for an archived project", () => {
    // Archived projects are excluded from the default view, so pinning one
    // does nothing. The card this replaces omitted it too.
    const { open, queryByText } = setup({ hidden: true, pinned: false });
    open();
    expect(queryByText("pin")).toBeNull();
    expect(queryByText("unpin")).toBeNull();
  });

  test("an item fires its callback and closes the menu", () => {
    const { props, open, getByText, queryByText } = setup();
    open();
    fireEvent.click(getByText("refresh"));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(queryByText("refresh")).toBeNull();
  });

  test("archive fires onToggleArchive", () => {
    const { props, open, getByText } = setup();
    open();
    fireEvent.click(getByText("archive"));
    expect(props.onToggleArchive).toHaveBeenCalledTimes(1);
  });

  test("copy path fires onCopyPath", () => {
    const { props, open, getByText } = setup();
    open();
    fireEvent.click(getByText("copy path"));
    expect(props.onCopyPath).toHaveBeenCalledTimes(1);
  });

  test("clicking outside closes the menu", () => {
    const { open, queryByText } = setup();
    open();
    expect(queryByText("refresh")).toBeTruthy();
    fireEvent.click(document.body);
    expect(queryByText("refresh")).toBeNull();
  });

  test("stops click propagation so the card underneath does not navigate", () => {
    const onParent = vi.fn();
    const { container } = render(() => (
      <div onclick={onParent}>
        <CardMenu
          pinned={false} hidden={false}
          onOpen={() => {}} onRefresh={() => {}} onCopyPath={() => {}}
          onTogglePin={() => {}} onToggleArchive={() => {}}
        />
      </div>
    ));
    fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement);
    expect(onParent).not.toHaveBeenCalled();
  });

  test("removes the document click listener it registered, on unmount", () => {
    // Solid delegates click to document too, and never removes that one — so
    // assert that *a* handler added during render is later removed, rather than
    // that every click listener disappears.
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    try {
      const { unmount } = setup();
      const added = addSpy.mock.calls.filter((c) => c[0] === "click").map((c) => c[1]);
      expect(added.length).toBeGreaterThan(0);

      unmount();

      const removed = removeSpy.mock.calls.filter((c) => c[0] === "click").map((c) => c[1]);
      expect(added.some((h) => removed.includes(h))).toBe(true);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/CardMenu.test.tsx`
Expected: FAIL — cannot resolve `../src/components/CardMenu`.

- [ ] **Step 3: Create `web/src/components/CardMenu.tsx`**

```tsx
import { Show, createSignal, onCleanup } from "solid-js";

export type CardMenuProps = {
  pinned: boolean;
  hidden: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onCopyPath: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
};

/**
 * The card's only action affordance: always visible, click to open. Not
 * hover-revealed, so touch and keyboard work without a special path.
 * Click-outside handling follows the pattern in LauncherButton.tsx.
 */
export default function CardMenu(props: CardMenuProps) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLSpanElement | undefined;

  // The `contains` guard is load-bearing, not defensive. Solid delegates click
  // to the document, so a click inside the menu has *already* reached document
  // by the time any handler runs — `stopPropagation()` in a child handler does
  // not un-deliver it to this native listener. Without the guard, opening the
  // menu would immediately close it again.
  const onDocClick = (e: MouseEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("click", onDocClick);
  onCleanup(() => document.removeEventListener("click", onDocClick));

  // Every click inside the menu is stopped so the card body's navigate handler
  // never fires.
  const swallow = (e: MouseEvent) => e.stopPropagation();

  const item = (label: string, run: () => void, danger = false) => (
    <button
      class={`card-menu-item${danger ? " danger" : ""}`}
      onclick={(e) => {
        e.stopPropagation();
        setOpen(false);
        run();
      }}
    >
      {label}
    </button>
  );

  return (
    <span class="card-menu" ref={rootRef} onclick={swallow}>
      <button
        class="card-menu-trigger"
        title="more"
        aria-label="more"
        aria-expanded={open()}
        onclick={(e) => {
          e.stopPropagation();
          setOpen(!open());
        }}
      >
        {/* Inline SVG rather than a ☰ glyph: no font metrics, so the icon is
            centred by the flex box alone. */}
        <svg width="11" height="9" viewBox="0 0 11 9" aria-hidden="true">
          <path
            d="M.6 1h9.8M.6 4.5h9.8M.6 8h9.8"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
      <Show when={open()}>
        <span class="card-menu-popover">
          {item("open", props.onOpen)}
          {item("refresh", props.onRefresh)}
          {item("copy path", props.onCopyPath)}
          <span class="card-menu-rule" />
          {/* No pin option for an archived project: archived projects are
              excluded from the default view, so pinning one does nothing.
              The card this replaces omitted it for the same reason. */}
          <Show when={!props.hidden}>
            {item(props.pinned ? "unpin" : "pin", props.onTogglePin)}
          </Show>
          {item(props.hidden ? "restore" : "archive", props.onToggleArchive, !props.hidden)}
        </span>
      </Show>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- tests/CardMenu.test.tsx`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CardMenu.tsx web/tests/CardMenu.test.tsx
git commit -m "feat(card): add the always-visible card actions menu"
```

> **Added during execution — keyboard handling.** The component above is the
> shipped structure, but code review found the stated rationale for
> always-visible-and-click ("hover excludes keyboard and touch") only half held:
> there was no Escape to close, and activating an item unmounted the focused
> button via `<Show>`, dropping focus to `<body>` so the user Tabbed from the top
> of the page again. Both were closed in a follow-up commit — Escape closes and
> returns focus to the trigger, and firing an item also returns focus there.
>
> Deliberately **not** added: `role="menu"` / `role="menuitem"` / arrow-key roving
> focus. Native `<button>`s plus `aria-expanded` make this a disclosure of
> buttons rather than an ARIA menu widget, which is the simpler correct pattern
> here.

---

### Task 8: Rewrite `ProjectCard`

Several existing assertions break by design. Replace the test file rather than
patching it.

**Files:**
- Rewrite: `web/src/components/ProjectCard.tsx`
- Rewrite: `web/tests/ProjectCard.test.tsx`
- Modify: `web/tests/ProjectCard.archive.test.tsx`

- [ ] **Step 1: Note what the existing archive test needs**

`web/tests/ProjectCard.archive.test.tsx` reaches its buttons with
`screen.getByTitle("archive")` / `getByTitle("restore")`. Menu items are text
buttons with no `title`, and they live behind the trigger, so every interaction
needs one extra click and `getByText` instead. Its full replacement is in Step 5.

Its `vi.mock("../src/api", …)` stub exports only `patchProject` and
`refreshProject`, which remains sufficient — the rewritten `ProjectCard` imports
exactly those two from `../api`.

- [ ] **Step 2: Write the failing test**

Replace `web/tests/ProjectCard.test.tsx` entirely:

```tsx
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Router, Route } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";
import { THEME_BY_ID } from "../src/lib/themes/index";

const k = THEME_BY_ID["forest-dark"]!.tokens;

const base: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false, group: null,
  scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: Date.now(), services: { docker: [], processes: [] }, errors: [],
  },
};

function renderCard(project: ProjectRow, over: { preset?: any; colorBy?: any; groups?: string[] } = {}) {
  return render(() => (
    <Router>
      <Route path="/" component={() => (
        <ProjectCard
          project={project}
          preset={over.preset ?? "status"}
          colorBy={over.colorBy ?? "git"}
          groups={over.groups ?? []}
          onChange={() => {}}
        />
      )} />
    </Router>
  ));
}

const band = (c: HTMLElement) => c.querySelector(".card-band") as HTMLElement;

describe("ProjectCard — band", () => {
  test("renders the name in the band", () => {
    renderCard(base);
    expect(screen.getByText("demo")).toBeTruthy();
  });

  test("has no status dot and no pin star", () => {
    const { container } = renderCard({ ...base, pinned: true });
    expect(container.querySelector(".dot")).toBeNull();
    expect(container.querySelector(".pin")).toBeNull();
  });

  test("colors the band ok when clean and error when errors exist", () => {
    const clean = renderCard(base);
    expect(band(clean.container).style.getPropertyValue("--k")).toBe(k.ok);
    clean.unmount();

    const bad = renderCard({ ...base, snapshot: { ...base.snapshot!, errors: ["docker unreachable"] } });
    expect(band(bad.container).style.getPropertyValue("--k")).toBe(k.error);
  });

  test("sets a derived band foreground alongside the background", () => {
    const { container } = renderCard(base);
    expect(band(container).style.getPropertyValue("--kfg")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("renders the group tag, and the archived tag only when hidden", () => {
    const a = renderCard({ ...base, group: "Personal" });
    expect(a.getByText("Personal")).toBeTruthy();
    expect(a.queryByText("archived")).toBeNull();
    a.unmount();

    const b = renderCard({ ...base, hidden: true });
    expect(b.getByText("archived")).toBeTruthy();
  });

  test("always renders the actions menu trigger", () => {
    const { container } = renderCard(base);
    expect(container.querySelector(".card-menu-trigger")).toBeTruthy();
  });
});

describe("ProjectCard — status preset", () => {
  test("shows the branch and the dirty count", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git, dirty: true, changed: 4 } } });
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
  });

  test("emits no clean chip and no 'no services' fallback", () => {
    const { container } = renderCard(base);
    expect(container.textContent).not.toContain("clean");
    expect(container.textContent).not.toContain("no services");
  });

  test("renders each distinct port as its own chip", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, services: { docker: [], processes: [
      { pid: 100, command: "vite", cwd: "/p", ports: [5173, 3000] },
      { pid: 200, command: "bun", cwd: "/p", ports: [52810] },
    ] } } });
    expect(screen.getByText(":3000")).toBeTruthy();
    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":52810")).toBeTruthy();
  });

  test("renders terminals and agent chips", () => {
    const { container } = renderCard({ ...base, liveSessions: 2, liveAgents: [{ agent: "claude", count: 2 }] });
    expect(container.textContent).toContain("2 terminals");
    expect(container.textContent).toContain("🤖 2");
  });

  test("lists errors", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, errors: ["docker: docker unreachable"] } });
    expect(screen.getByText("docker: docker unreachable")).toBeTruthy();
  });

  test("the chip row is the last thing in the body, so margin-top:auto can float it", () => {
    // vitest's jsdom does not load styles.css and does no layout, so neither
    // the computed margin nor the resulting height is observable here. What IS
    // observable — and what the CSS depends on — is that the chip row is the
    // final child of the flex column. The pixel geometry is verified in the
    // browser in Task 10 Step 4.
    const { container } = renderCard({
      ...base,
      snapshot: { ...base.snapshot!, errors: ["docker unreachable"] },
    });
    const body = container.querySelector(".card-body") as HTMLElement;
    expect(body.lastElementChild?.className).toContain("card-chips");
  });
});

describe("ProjectCard — other presets", () => {
  test("compact renders one summary line and no chips", () => {
    const { container } = renderCard(base, { preset: "compact" });
    expect(container.querySelector(".card-chips")).toBeNull();
    expect(container.textContent).toContain("main · clean");
  });

  test("detail renders labelled rows including the commit message", () => {
    const { container } = renderCard({
      ...base,
      snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git,
        lastCommit: { sha: "a", message: "fix: a thing", timestamp: Date.now() - 3_600_000 } } },
    }, { preset: "detail" });
    expect(container.textContent).toContain("commit");
    expect(container.textContent).toContain("fix: a thing");
  });
});

describe("ProjectCard — no snapshot", () => {
  test("says it has not been scanned and stays on a neutral band", () => {
    const { container } = renderCard({ ...base, snapshot: null });
    expect(container.textContent).toContain("not scanned yet");
    expect(band(container).style.getPropertyValue("--k")).toBe(k.bg3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && bun run test -- tests/ProjectCard.test.tsx`
Expected: FAIL — `ProjectCard` does not accept `preset`/`colorBy`/`groups` and
renders no `.card-band`.

- [ ] **Step 4: Rewrite `web/src/components/ProjectCard.tsx`**

```tsx
import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ProjectRow } from "../api";
import { refreshProject, patchProject } from "../api";
import CardMenu from "./CardMenu";
import { bandColor, type ColorByDimension } from "../lib/colorBy";
import {
  compactLine, detailRows, statusChips, type ViewPreset,
} from "../lib/dashboard-view";
import { currentTheme } from "../lib/themes/current";

export default function ProjectCard(props: {
  project: ProjectRow;
  preset: ViewPreset;
  colorBy: ColorByDimension;
  groups: string[];
  onChange: () => void;
}) {
  const nav = useNavigate();

  // currentTheme() reads themeId(), so the band recolors on a theme change.
  const band = () =>
    bandColor(props.project, props.colorBy, props.groups, currentTheme(), Date.now());

  const open = () => nav(`/projects/${encodeURIComponent(props.project.id)}`);

  const onRefresh = async () => {
    await refreshProject(props.project.id);
    props.onChange();
  };
  const onTogglePin = async () => {
    await patchProject(props.project.id, { pinned: !props.project.pinned });
    props.onChange();
  };
  const onToggleArchive = async () => {
    await patchProject(props.project.id, { hidden: !props.project.hidden });
    props.onChange();
  };
  const onCopyPath = () => {
    void navigator.clipboard?.writeText(props.project.path);
  };

  const onCardClick = (e: MouseEvent) => {
    // CardMenu stops its own clicks, so anything arriving here is the body.
    if ((e.target as HTMLElement).closest(".card-menu")) return;
    open();
  };

  return (
    <div class="card card-clickable" onclick={onCardClick}>
      <div
        class={`card-band${band().neutral ? " neutral" : ""}`}
        style={{ "--k": band().bg, "--kfg": band().fg }}
      >
        <span class="card-title" title={props.project.name}>{props.project.name}</span>
        <span class="card-band-right">
          <Show when={props.project.hidden}>
            <span class="card-band-tag archived" title="archived">archived</span>
          </Show>
          <Show when={props.project.group}>
            <span class="card-band-tag" title="inferred from sub-directory under scan root">
              {props.project.group}
            </span>
          </Show>
          <CardMenu
            pinned={props.project.pinned}
            hidden={props.project.hidden}
            onOpen={open}
            onRefresh={onRefresh}
            onCopyPath={onCopyPath}
            onTogglePin={onTogglePin}
            onToggleArchive={onToggleArchive}
          />
        </span>
      </div>

      <div class="card-body">
        <Show when={props.preset === "compact"}>
          <div class="card-line">{compactLine(props.project, Date.now())}</div>
        </Show>

        <Show when={props.preset === "status"}>
          <Show
            when={props.project.snapshot}
            fallback={<div class="card-line faint">not scanned yet</div>}
          >
            {(snap) => (
              <>
                <div class="card-branch">{snap().git.branch ?? "detached"}</div>
                <Show when={snap().errors.length > 0}>
                  <ul class="card-errors">
                    <For each={snap().errors}>{(e) => <li>{e}</li>}</For>
                  </ul>
                </Show>
                <div class="card-chips">
                  <For each={statusChips(props.project, Date.now())}>
                    {(c) => <span class={`chip chip-${c.tone}`} title={c.title}>{c.label}</span>}
                  </For>
                </div>
              </>
            )}
          </Show>
        </Show>

        <Show when={props.preset === "detail"}>
          <Show
            when={props.project.snapshot}
            fallback={<div class="card-line faint">not scanned yet</div>}
          >
            <dl class="card-rows">
              <For each={detailRows(props.project, Date.now())}>
                {(row) => (
                  <>
                    <dt>{row.label}</dt>
                    <dd class={row.label === "commit" ? "clamp-2" : undefined}>{row.value}</dd>
                  </>
                )}
              </For>
            </dl>
          </Show>
        </Show>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `web/tests/ProjectCard.archive.test.tsx` entirely**

```tsx
import { render, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, afterEach } from "vitest";
import { Router, Route } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";

const patchProject = vi.fn();
const refreshProject = vi.fn();

vi.mock("../src/api", () => ({
  patchProject: (...a: unknown[]) => patchProject(...a),
  refreshProject: (...a: unknown[]) => refreshProject(...a),
}));

afterEach(() => { patchProject.mockReset(); refreshProject.mockReset(); });

const base: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false,
  group: null, scannedAt: 0, liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: null, services: { docker: [], processes: [] }, errors: [],
  },
};

function renderCard(project: ProjectRow, onChange = () => {}) {
  return render(() => (
    <Router>
      <Route path="/" component={() => (
        <ProjectCard
          project={project}
          preset="status"
          colorBy="git"
          groups={[]}
          onChange={onChange}
        />
      )} />
    </Router>
  ));
}

/** Actions live behind the menu now, so every interaction opens it first. */
function openMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement);
}

describe("ProjectCard archive affordance", () => {
  test("visible card offers archive, which hides the project", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const onChange = vi.fn();
    const { container } = renderCard(base, onChange);
    openMenu(container);
    fireEvent.click(screen.getByText("archive"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  test("hidden card shows an archived tag and offers restore, which un-hides", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const { container } = renderCard({ ...base, hidden: true });
    expect(screen.getByText("archived")).toBeTruthy();
    openMenu(container);
    fireEvent.click(screen.getByText("restore"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: false }));
  });

  test("hidden card offers neither archive nor pin", () => {
    const { container } = renderCard({ ...base, hidden: true });
    openMenu(container);
    expect(screen.queryByText("archive")).toBeNull();
    expect(screen.queryByText("pin")).toBeNull();
    expect(screen.queryByText("unpin")).toBeNull();
  });

  test("an archived project shows no pinned star anywhere", () => {
    const { container } = renderCard({ ...base, pinned: true, hidden: true });
    expect(container.querySelector(".pin")).toBeNull();
    expect(screen.getByText("archived")).toBeTruthy();
  });

  test("visible card offers pin, which pins the project", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("pin"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { pinned: true }));
  });

  test("refresh calls the refresh endpoint", async () => {
    refreshProject.mockResolvedValue({ ok: true });
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(refreshProject).toHaveBeenCalledWith("abc"));
  });
});
```

- [ ] **Step 6: Run both card test files**

Run: `cd web && bun run test -- tests/ProjectCard.test.tsx tests/ProjectCard.archive.test.tsx`
Expected: PASS — every test in both files. Nothing here depends on Task 10's CSS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ProjectCard.tsx web/tests/ProjectCard.test.tsx web/tests/ProjectCard.archive.test.tsx
git commit -m "feat(card): rebuild the project card around a colored title band"
```

---

### Task 9: Grid and dashboard toolbar

**Files:**
- Modify: `web/src/components/ProjectGrid.tsx`
- Modify: `web/src/pages/Dashboard.tsx`
- Test: `web/tests/Dashboard.toolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/tests/Dashboard.toolbar.test.tsx`:

```tsx
import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, beforeEach } from "vitest";
import DashboardToolbar from "../src/components/DashboardToolbar";
import { THEME_BY_ID } from "../src/lib/themes/index";
import { setDashboardColorBy, setDashboardPreset } from "../src/lib/preferences";

const theme = THEME_BY_ID["forest-dark"]!;

// persistedSignal creates module-level singletons that read localStorage once at
// import time, so clearing storage would NOT reset them. Reset via the setters
// instead, or these tests leak state into each other in file order.
beforeEach(() => {
  setDashboardPreset("status");
  setDashboardColorBy("git");
});

function setup(groups: string[] = []) {
  const utils = render(() => (
    <DashboardToolbar query="" onQuery={() => {}} groups={groups} theme={theme} />
  ));
  const legendLabels = () =>
    [...utils.container.querySelectorAll(".legend-entry")].map((e) => e.textContent);
  const pickColorBy = (v: string) => {
    const select = utils.container.querySelector(".colorby-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: v } });
  };
  return { ...utils, legendLabels, pickColorBy };
}

describe("DashboardToolbar", () => {
  test("renders one button per view preset", () => {
    const { getByRole } = setup();
    for (const p of ["compact", "status", "detail"]) {
      expect(getByRole("button", { name: p })).toBeTruthy();
    }
  });

  test("marks exactly one preset active, defaulting to status", () => {
    const { container } = setup();
    const active = container.querySelectorAll(".preset-btn.active");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe("status");
  });

  test("switching preset moves the active marker", () => {
    const { container, getByRole } = setup();
    fireEvent.click(getByRole("button", { name: "compact" }));
    const active = container.querySelectorAll(".preset-btn.active");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe("compact");
  });

  test("offers all six color-by dimensions in order", () => {
    const { container } = setup();
    const opts = [...container.querySelectorAll(".colorby-select option")]
      .map((o) => o.getAttribute("value"));
    expect(opts).toEqual(["git", "heat", "services", "agents", "group", "none"]);
  });

  test("renders the git legend by default", () => {
    expect(setup().legendLabels()).toEqual(["clean", "dirty", "error", "none"]);
  });

  test("the legend follows the selected dimension", () => {
    const { legendLabels, pickColorBy } = setup();
    pickColorBy("heat");
    expect(legendLabels()).toEqual(["today", "week", "month", "quarter", "older"]);
  });

  test("the group legend lists real groups plus ungrouped", () => {
    const { legendLabels, pickColorBy } = setup(["Personal", "Work"]);
    pickColorBy("group");
    expect(legendLabels()).toEqual(["Personal", "Work", "ungrouped"]);
  });

  test("none shows no legend entries", () => {
    const { legendLabels, pickColorBy } = setup();
    pickColorBy("none");
    expect(legendLabels()).toEqual([]);
  });

  test("typing in the search box reports upward", () => {
    let seen = "";
    const { container } = render(() => (
      <DashboardToolbar query="" onQuery={(q) => (seen = q)} groups={[]} theme={theme} />
    ));
    fireEvent.input(container.querySelector(".search-input") as HTMLInputElement, {
      target: { value: "forest" },
    });
    expect(seen).toBe("forest");
  });
});
```

`DashboardToolbar` needs no `Router` wrapper — it holds no links and never
navigates.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- tests/Dashboard.toolbar.test.tsx`
Expected: FAIL — cannot resolve `../src/components/DashboardToolbar`.

- [ ] **Step 3: Create `web/src/components/DashboardToolbar.tsx`**

Extracted from `Dashboard.tsx` rather than inlined, so it is testable without
mocking the projects resource.

```tsx
import { For } from "solid-js";
import type { Theme } from "../lib/themes/types";
import { COLOR_BY_DIMENSIONS, legend, type ColorByDimension } from "../lib/colorBy";
import { VIEW_PRESETS } from "../lib/dashboard-view";
import type { ProjectSort } from "../lib/project-list";
import {
  dashboardColorBy, setDashboardColorBy,
  dashboardPreset, setDashboardPreset,
  dashboardSort, setDashboardSort,
} from "../lib/preferences";

export default function DashboardToolbar(props: {
  query: string;
  onQuery: (q: string) => void;
  groups: string[];
  theme: Theme;
}) {
  return (
    <div class="dashboard-toolbar">
      <input
        class="search-input"
        type="search"
        placeholder="search projects…"
        value={props.query}
        oninput={(e) => props.onQuery(e.currentTarget.value)}
      />
      <select
        class="sort-select"
        value={dashboardSort()}
        onchange={(e) => setDashboardSort(e.currentTarget.value as ProjectSort)}
      >
        <option value="recent">recent</option>
        <option value="running">running</option>
        <option value="name">name</option>
      </select>

      <div class="preset-group" role="group" aria-label="card detail">
        <For each={VIEW_PRESETS}>
          {(p) => (
            <button
              class={`preset-btn${dashboardPreset() === p ? " active" : ""}`}
              onclick={() => setDashboardPreset(p)}
            >
              {p}
            </button>
          )}
        </For>
      </div>

      <select
        class="colorby-select"
        aria-label="color by"
        value={dashboardColorBy()}
        onchange={(e) => setDashboardColorBy(e.currentTarget.value as ColorByDimension)}
      >
        <For each={COLOR_BY_DIMENSIONS}>
          {(d) => <option value={d}>color: {d}</option>}
        </For>
      </select>

      <div class="legend">
        <For each={legend(dashboardColorBy(), props.groups, props.theme)}>
          {(e) => (
            <span class="legend-entry">
              <span class="legend-swatch" style={{ background: e.swatch }} />
              {e.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
```

Note: `.legend-entry` must contain only the label as text for the tests above to
read it cleanly — the swatch is a nested empty `<span>`, which contributes no
text content.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- tests/Dashboard.toolbar.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Thread the new props through `ProjectGrid`**

Replace `web/src/components/ProjectGrid.tsx`:

```tsx
import { For } from "solid-js";
import type { ProjectRow } from "../api";
import ProjectCard from "./ProjectCard";
import type { ColorByDimension } from "../lib/colorBy";
import type { ViewPreset } from "../lib/dashboard-view";

export default function ProjectGrid(props: {
  projects: ProjectRow[];
  preset: ViewPreset;
  colorBy: ColorByDimension;
  groups: string[];
  onChange: () => void;
}) {
  return (
    <div class="grid">
      <For each={props.projects}>
        {(p) => (
          <ProjectCard
            project={p}
            preset={props.preset}
            colorBy={props.colorBy}
            groups={props.groups}
            onChange={props.onChange}
          />
        )}
      </For>
    </div>
  );
}
```

- [ ] **Step 6: Wire `Dashboard.tsx`**

In `web/src/pages/Dashboard.tsx`:

1. Replace the inline `<div class="dashboard-toolbar">…</div>` block (currently
   `Dashboard.tsx:39-56`) with `<DashboardToolbar query={query()} onQuery={setQuery} groups={groups()} theme={currentTheme()} />`.
2. Add these imports:

```tsx
import DashboardToolbar from "../components/DashboardToolbar";
import { groupsOf } from "../lib/colorBy";
import { currentTheme } from "../lib/themes/current";
import { dashboardColorBy, dashboardPreset } from "../lib/preferences";
```

3. Add a derived groups list next to the other derivations. **It must cover
   every project that can actually be rendered, not just `visible()`:**

```tsx
// Search results merge visible + archived (see searchProjects), so a group
// that exists only on an archived project must still be in this list.
// bandColor() resolves a group to a hue by its index here and silently
// returns the neutral band when the group is absent — so computing this over
// visible() alone would make archived search hits mysteriously lose their
// color, indistinguishable from a genuinely ungrouped project.
const groups = () => groupsOf([...visible(), ...archived()]);
```

> **Found in Task 3's code review.** The reviewer flagged that `hueFor`
> returns neutral silently for a group missing from `groups`, and suggested a
> dev-time warning inside `colorBy`. The real defect is here in the caller, not
> in `colorBy` — so this is fixed at the source and `hueFor` stays as-is.

4. Pass the new props to all three `<ProjectGrid …>` call sites (pinned, all,
   results):

```tsx
<ProjectGrid
  projects={pinned()}
  preset={dashboardPreset()}
  colorBy={dashboardColorBy()}
  groups={groups()}
  onChange={onChange}
/>
```

5. Remove the now-unused `sortProjects`-adjacent imports only if TypeScript
   reports them unused — `dashboardSort` moved into the toolbar, but
   `Dashboard.tsx` still uses it for `others()` and `results()`, so keep it.

- [ ] **Step 7: Run the full suite and a type check**

Run: `bun run test:web`
Expected: PASS.

Run: `bun run build:web` and `cd web && bunx tsc --noEmit`
Expected: the build succeeds, and `tsc` reports no *new* errors.

> **`build:web` does not type-check.** `web/vite.config.ts` has no type-checking
> plugin and `build` is a bare `vite build`, so Vite transpiles with esbuild and
> never runs `tsc`. A missing required prop compiles clean and fails only at
> runtime — which is exactly how `Archives.tsx` was nearly shipped rendering
> empty card bodies. Always pair the build with `tsc --noEmit`, and compare
> against a baseline: there is pre-existing unrelated debt in `App.tsx`,
> `ProjectDetail.tsx` and several test files.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/DashboardToolbar.tsx web/src/components/ProjectGrid.tsx web/src/pages/Dashboard.tsx web/tests/Dashboard.toolbar.test.tsx
git commit -m "feat(dashboard): add view presets, color-by and a legend to the toolbar"
```

---

### Task 10: CSS — band, chips, equal-height rows, and the toolbar height fix

No unit test drives CSS (jsdom does no layout), so this task ends with an
in-browser measurement instead. The `marginTop` assertion from Task 8 is the one
automated guard.

**Files:**
- Modify: `web/src/styles.css:54-90` (grid/card block) and `:981-985` (toolbar)

- [ ] **Step 1: Replace the card block at `web/src/styles.css:54-90`**

```css
/* A separate :root block, deliberately NOT merged into the one at the top of the
   file. That block's comment says applyTheme() overwrites every property in it
   on <html> at boot; these three are geometry, not theme tokens, so no theme
   supplies them and they must live outside it. */
:root {
  --control-h: 28px;   /* every toolbar control */
  --icon-btn: 20px;    /* every square icon button and band tag */
  --band-pad: 6px;
}

.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.9rem; }
@media (max-width: 1024px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }

/* Cards in a row match the tallest — the grid's default stretch. The card is a
   column flexbox so .card-body can absorb the extra height. */
.card {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px;
  display: flex; flex-direction: column; min-width: 0; overflow: visible;
}
.card-clickable { cursor: pointer; transition: border-color 100ms ease; }
.card-clickable:hover { border-color: var(--fg-dim); }

/* The band never uses borders: align-items:center centres within the content
   box, so a border would shift the optical centre half a pixel off the icon.
   The neutral separator is an inset shadow, which paints without entering
   layout. */
.card-band {
  flex: 0 0 auto; display: flex; align-items: center; gap: 0.4rem;
  box-sizing: border-box; border-radius: 5px 5px 0 0;
  padding: var(--band-pad); padding-left: 0.6rem;
  min-height: calc(var(--icon-btn) + var(--band-pad) * 2);
  background: var(--k); color: var(--kfg); min-width: 0;
}
/* Driven by bandColor().neutral, not by inspecting --k: the inline value is a
   resolved hex, so an attribute selector could never match it. */
.card-band.neutral { box-shadow: inset 0 -1px 0 var(--border); }
.card-title {
  flex: 1; min-width: 0; font-weight: 600; font-size: 0.85rem; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-band-right { display: flex; align-items: center; gap: 0.3rem; flex: 0 0 auto; }

/* Tags and the menu trigger all borrow the band's derived foreground via
   currentColor, so they need no tokens of their own. */
.card-band-tag {
  height: var(--icon-btn); box-sizing: border-box; display: inline-flex;
  align-items: center; padding: 0 0.34rem; border-radius: 3px;
  font-size: 0.6rem; line-height: 1; white-space: nowrap; color: inherit;
  border: 1px solid color-mix(in srgb, currentColor 38%, transparent);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.card-band-tag.archived {
  border-style: dashed; background: none; opacity: 0.85;
}

.card-body {
  flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0;
  padding: 0.45rem 0.65rem 0.5rem;
}
.card-line { color: var(--fg-dim); font-size: 0.78rem; }
.card-line.faint { color: var(--fg-faint); }
/* Truncates from the left so the identifying tail of a branch survives. */
.card-branch {
  color: var(--fg-dim); font-size: 0.78rem; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;
}
.card-errors {
  margin: 0.3rem 0 0; padding-left: 1.1em; color: var(--error); font-size: 0.72rem;
}
/* margin-top:auto is the whole equal-height mechanism: it moves the slack above
   the chips, so every card in a row lands its chip row on one baseline. */
.card-chips {
  margin-top: auto; padding-top: 0.35rem;
  display: flex; flex-wrap: wrap; gap: 0.25rem;
}
.chip {
  font-size: 0.72rem; line-height: 1.5; padding: 0.02rem 0.32rem; border-radius: 3px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg-dim);
  white-space: nowrap;
}
.chip-dirty  { color: var(--warn);  border-color: color-mix(in srgb, var(--warn) 40%, transparent);  background: color-mix(in srgb, var(--warn) 8%, transparent); }
.chip-ahead,
.chip-running { color: var(--ok);   border-color: color-mix(in srgb, var(--ok) 35%, transparent);    background: color-mix(in srgb, var(--ok) 8%, transparent); }
.chip-behind { color: var(--error); border-color: color-mix(in srgb, var(--error) 40%, transparent); background: color-mix(in srgb, var(--error) 8%, transparent); }
.chip-agent  { color: var(--info);  border-color: color-mix(in srgb, var(--info) 35%, transparent);  background: color-mix(in srgb, var(--info) 8%, transparent); }
.chip-bare   { border-color: transparent; background: none; padding-left: 0; }

.card-rows {
  margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.5rem;
  font-size: 0.78rem;
}
.card-rows dt {
  color: var(--fg-faint); font-size: 0.62rem; text-transform: uppercase;
  letter-spacing: 0.06em; padding-top: 0.14rem;
}
.card-rows dd { margin: 0; color: var(--fg-dim); overflow-wrap: anywhere; }
/* Real merge subjects otherwise wrap to three lines and swamp the card. */
.card-rows dd.clamp-2 {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

/* --- card menu --- */
.card-menu { position: relative; display: inline-flex; }
.card-menu-trigger {
  width: var(--icon-btn); height: var(--icon-btn); box-sizing: border-box;
  padding: 0; flex: 0 0 auto; cursor: pointer; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit; background: color-mix(in srgb, currentColor 10%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}
.card-menu-trigger:hover { background: color-mix(in srgb, currentColor 24%, transparent); }
.card-menu-trigger svg { display: block; }
.card-menu-popover {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 20; min-width: 124px;
  display: flex; flex-direction: column; padding: 0.2rem;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 5px;
  box-shadow: 0 8px 22px #000a;
}
.card-menu-item {
  font: inherit; font-size: 0.78rem; text-align: left; cursor: pointer;
  background: none; border: none; color: var(--fg-dim);
  padding: 0.24rem 0.45rem; border-radius: 3px;
}
.card-menu-item:hover { background: var(--bg-3); color: var(--fg); }
.card-menu-item.danger:hover { color: var(--error); }
.card-menu-rule { border-top: 1px solid var(--border); margin: 0.18rem 0.1rem; }
```

Delete the old `.card-head`, `.card-meta`, `.card-section`, `.services`,
`.svc-*`, `.ports`, `.port-chip`, `.group-tag`, `.card-name`, `.pin`, `.dot`,
`.dot-ok`, `.dot-warn`, `.dot-error`, `.git-stat`, `.git-clean`, `.git-dirty`,
`.git-ahead`, `.git-behind` rules — they have no remaining consumers. Verify with
`grep -rn "svc-count\|port-chip\|git-stat\|card-meta\|dot-ok" web/src` returning
nothing before deleting.

- [ ] **Step 2: Replace the toolbar block at `web/src/styles.css:981-985`**

The existing bug: `.search-input` has `padding: .4rem .6rem`, `.sort-select` has
`.4rem .5rem`, and neither sets a height, so the native select applies its own
intrinsic metrics and lands a couple of pixels shy of the input.

```css
.dashboard-toolbar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
/* One height for every control in the row. box-sizing + explicit height +
   line-height:1 is what makes an <input> and a <select> agree. */
.dashboard-toolbar > * { height: var(--control-h); box-sizing: border-box; }
.dashboard-toolbar input,
.dashboard-toolbar select {
  height: var(--control-h); box-sizing: border-box; margin: 0;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 4px; font: inherit; font-size: 0.8rem; line-height: 1;
  padding: 0 0.55rem;
}
.dashboard-toolbar input:focus,
.dashboard-toolbar select:focus { outline: none; border-color: var(--accent); }
.dashboard-toolbar .search-input { flex: 1; min-width: 0; }
/* appearance:none stops the UA imposing its own select metrics; the chevron is
   drawn with two gradients so no asset is needed. */
.dashboard-toolbar select {
  appearance: none; -webkit-appearance: none; padding-right: 1.5rem;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--fg-dim) 50%),
    linear-gradient(135deg, var(--fg-dim) 50%, transparent 50%);
  background-position: calc(100% - 13px) center, calc(100% - 8px) center;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.preset-group { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.preset-btn {
  font: inherit; font-size: 0.8rem; line-height: 1; padding: 0 0.55rem; cursor: pointer;
  display: inline-flex; align-items: center; border: none; border-radius: 0;
  background: var(--bg); color: var(--fg-dim);
}
.preset-btn + .preset-btn { border-left: 1px solid var(--border); }
.preset-btn.active {
  color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg));
}
.legend {
  display: flex; align-items: center; gap: 0.45rem; margin-left: auto;
  font-size: 0.68rem; color: var(--fg-dim);
}
.legend-entry { display: inline-flex; align-items: center; gap: 0.24rem; }
.legend-swatch { width: 9px; height: 9px; border-radius: 2px; display: block; }
```

- [ ] **Step 3: Build and run the app**

Run: `bun run build:web`
Expected: succeeds.

Run: `bun run dev:server` and `bun run dev:web`, then open
http://localhost:5173.

- [ ] **Step 4: Verify the geometry in the browser**

Paste into the browser console. Every assertion must print `true`.

```js
const r = n => Math.round(n * 100) / 100;
const ctrls = [...document.querySelectorAll('.dashboard-toolbar > *')];
console.log('toolbar heights all equal:',
  new Set(ctrls.map(c => r(c.getBoundingClientRect().height))).size === 1,
  [...new Set(ctrls.map(c => r(c.getBoundingClientRect().height)))]);

const cards = [...document.querySelectorAll('.grid > .card')];
const rows = {};
for (const c of cards) {
  const b = c.getBoundingClientRect();
  (rows[Math.round(b.top)] ??= []).push(r(b.height));
}
console.log('every row uniform:',
  Object.values(rows).every(hs => new Set(hs).size === 1), rows);

const bands = [...document.querySelectorAll('.card-band')];
console.log('band heights all equal:',
  new Set(bands.map(b => r(b.getBoundingClientRect().height))).size === 1);

console.log('hamburgers 20x20 and centred in their band:', cards.every(c => {
  const t = c.querySelector('.card-menu-trigger').getBoundingClientRect();
  const b = c.querySelector('.card-band').getBoundingClientRect();
  return r(t.width) === 20 && r(t.height) === 20 &&
         r((t.top + t.height / 2) - (b.top + b.height / 2)) === 0;
}));

console.log('hamburger inset constant:', new Set(cards.map(c =>
  r(c.getBoundingClientRect().right -
    c.querySelector('.card-menu-trigger').getBoundingClientRect().right))).size === 1);
```

If `every row uniform` is false, the `.card` is missing
`display: flex; flex-direction: column`. If the hamburger offset is non-zero,
something re-introduced a border on `.card-band`.

- [ ] **Step 5: Check a light theme**

In the app, go to Settings → Appearance and pick **Solarized Light** — the theme
the spec identified as the one where the neutral band falls back to absolute
black. Confirm the band titles are readable and the toolbar controls still align.
Then check **Catppuccin Latte**.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.css
git commit -m "feat(css): style the card band, chips and equal-height rows

Also fixes a pre-existing bug where .search-input and .sort-select had
different padding and no height, so the native select rendered a couple of
pixels shy of the input."
```

---

### Task 11: Delete `ServiceList`

**Files:**
- Delete: `web/src/components/ServiceList.tsx`

- [ ] **Step 1: Confirm there are no remaining consumers**

Run: `grep -rn "ServiceList" web/src web/tests`
Expected: no output.

If anything is still importing it, stop and fix that first.

- [ ] **Step 2: Delete and verify**

```bash
git rm web/src/components/ServiceList.tsx
```

Run: `bun run test:web && bun run build:web`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: drop ServiceList, superseded by chip derivation"
```

---

### Task 12: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the dashboard description**

`README.md` describes the dashboard and settings but says nothing about presets
or color-by. Add a subsection after the **Settings** section and before
**Theming**:

```markdown
### Dashboard cards

Each project card leads with a colored title band. What the color *means* is up
to you — the **color by** dropdown in the dashboard toolbar switches between:

- **git** — clean / dirty / has errors (the default)
- **heat** — how recently the project was touched, today through months
- **services** — whether anything is running
- **agents** — whether an agent session is live in the project
- **group** — a stable hue per group, for spatially clustering a long grid
- **none** — a neutral band for everyone

A legend next to the dropdown decodes whichever dimension is active. Band text
colors are derived per theme so they stay readable on every hue, in all 16
themes.

Alongside it, a **compact / status / detail** control sets how much each card
shows — one summary line, a chip row of git and service state, or labelled rows
including the last commit message. Cards in a row share a height; the row is as
tall as its busiest project.

Per-card actions (open, refresh, copy path, pin, archive) live in the **☰** menu
in the band. Both the preset and the color-by choice are per-device, stored in
`localStorage`.
```

- [ ] **Step 2: Confirm the theming section needs no change**

The Theming section (`README.md:113`) says `buildTheme()` "expands a published
palette into the full token set" without naming a count. This plan adds **no**
new `ThemeTokens` keys — band foregrounds are derived at runtime by `colorBy.ts`
— so that sentence stays accurate. No edit needed; this step is a check, and
finding a stated number there means something drifted and should be verified
against `TOKEN_KEYS` in `web/src/lib/themes/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document dashboard presets, color-by and the card menu"
```

---

## Final verification

- [ ] Run `bun run test:web` — all pass.
- [ ] Run `bun run test:server` — all pass (nothing here touches the server, so
      this is a regression check).
- [ ] Run `bun run build:web` — succeeds.
- [ ] Run `cd web && bunx tsc --noEmit` — no *new* errors versus the pre-existing
      baseline. This is the real type gate; `build:web` uses esbuild and never
      type-checks (see Task 9).
- [ ] Confirm both `ProjectGrid` consumers render bodies: the dashboard **and**
      `/archives`. The archives page was missed in planning.
- [ ] Re-run the Task 10 Step 4 browser assertions one final time.
- [ ] Spot-check three themes: Forest Dark, Solarized Light, Catppuccin Latte.
- [ ] Cycle all six color-by dimensions and all three presets in the browser.
- [ ] Search for a pinned project and confirm it sorts above unpinned matches.
