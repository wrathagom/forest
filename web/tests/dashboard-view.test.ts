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
