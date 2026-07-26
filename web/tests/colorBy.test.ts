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

  test("a snapshot with lastEdit null and no commit is neutral (distinct from no snapshot)", () => {
    // A different code path than `snapshot: null`: lastActivity reaches this
    // via `snap.lastEdit ?? 0` and `snap.git.lastCommit?.timestamp ?? 0`
    // both falling back to 0, not via hueFor's `if (!snap) return null;` guard.
    const p = project({ snapshot: { ...project().snapshot!, lastEdit: null } });
    const band = bandColor(p, "heat", [], theme, NOW);
    expect(band.bg).toBe(k.bg3);
    expect(band.neutral).toBe(true);
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

  test("a running container still reads ok even with logged errors (unlike git)", () => {
    // Deliberate divergence from "git": "services" answers "is anything
    // running", not "is anything wrong", so it doesn't consult snap.errors.
    const p = project({
      snapshot: {
        ...project().snapshot!,
        services: { docker: [{ name: "web", state: "running", from: "compose" }], processes: [] },
        errors: ["docker down"],
      },
    });
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

  test("case-differing groups get a total order, stable across insertion order", () => {
    // "Work" and "work" are distinct entries (the Set dedupes case-sensitively)
    // but compare equal under the case-insensitive primary comparator. Without
    // a tiebreak, Array.sort's stability would let their relative order fall
    // back to Set insertion order — i.e. to project-list order — so the two
    // could swap positions (and therefore hues, via hueFor's "group" branch)
    // whenever the project list reorders. The tiebreak fixes their order
    // regardless of which one appears first in the input.
    const order1 = groupsOf([
      project({ group: "Alpha" }), project({ group: "Work" }), project({ group: "work" }),
    ]);
    const order2 = groupsOf([
      project({ group: "Alpha" }), project({ group: "work" }), project({ group: "Work" }),
    ]);
    expect(order1).toEqual(order2);
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

  test("heat lists its five buckets, hottest first, matching the ramp order", () => {
    expect(legend("heat", [], theme).map((e) => e.label))
      .toEqual(["today", "week", "month", "quarter", "older"]);
  });

  test("services lists running vs idle", () => {
    expect(legend("services", [], theme)).toEqual([
      { label: "running", swatch: k.ok },
      { label: "idle", swatch: k.bg3 },
    ]);
  });

  test("agents lists agents vs none", () => {
    expect(legend("agents", [], theme)).toEqual([
      { label: "agents", swatch: k.info },
      { label: "none", swatch: k.bg3 },
    ]);
  });
});
