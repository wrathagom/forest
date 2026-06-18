import { describe, expect, test } from "vitest";
import type { ProjectRow } from "../src/api";
import { lastActivity, sortProjects, matchesQuery, searchProjects } from "../src/lib/project-list";

function proj(over: Partial<ProjectRow> & { name: string }): ProjectRow {
  return {
    id: over.name,
    name: over.name,
    path: `/${over.name}`,
    pinned: false,
    hidden: false,
    group: null,
    scannedAt: 0,
    liveSessions: 0,
    liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: null,
      services: { docker: [], processes: [] },
      errors: [],
    },
    ...over,
  };
}

function withActivity(name: string, lastEdit: number, lastCommit: number | null): ProjectRow {
  return proj({
    name,
    snapshot: {
      git: {
        branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0,
        lastCommit: lastCommit === null ? null : { sha: "x", message: "m", timestamp: lastCommit },
      },
      lastEdit,
      services: { docker: [], processes: [] },
      errors: [],
    },
  });
}

describe("lastActivity", () => {
  test("is the max of lastEdit and lastCommit timestamp", () => {
    expect(lastActivity(withActivity("a", 100, 200))).toBe(200);
    expect(lastActivity(withActivity("b", 300, 200))).toBe(300);
    expect(lastActivity(withActivity("c", 50, null))).toBe(50);
  });
});

describe("sortProjects", () => {
  test("name: case-insensitive ascending", () => {
    const out = sortProjects([proj({ name: "Beta" }), proj({ name: "alpha" }), proj({ name: "Charlie" })], "name");
    expect(out.map((p) => p.name)).toEqual(["alpha", "Beta", "Charlie"]);
  });

  test("recent: most recent activity first", () => {
    const out = sortProjects([withActivity("old", 100, 0), withActivity("new", 900, 0)], "recent");
    expect(out.map((p) => p.name)).toEqual(["new", "old"]);
  });

  test("recent: a project with a live session sorts above more-recently-edited ones", () => {
    const live = { ...withActivity("live", 1, 0), liveSessions: 1 };
    const out = sortProjects([withActivity("fresh", 9999, 0), live], "recent");
    expect(out.map((p) => p.name)).toEqual(["live", "fresh"]);
  });

  test("running: orders by live session count descending", () => {
    const a = { ...proj({ name: "a" }), liveSessions: 1 };
    const b = { ...proj({ name: "b" }), liveSessions: 3 };
    const c = { ...proj({ name: "c" }), liveSessions: 0 };
    expect(sortProjects([a, b, c], "running").map((p) => p.name)).toEqual(["b", "a", "c"]);
  });

  test("does not mutate the input array", () => {
    const input = [proj({ name: "b" }), proj({ name: "a" })];
    sortProjects(input, "name");
    expect(input.map((p) => p.name)).toEqual(["b", "a"]);
  });

  test("recent: among multiple live projects, falls back to lastActivity", () => {
    const older = { ...withActivity("older", 100, 0), liveSessions: 1 };
    const newer = { ...withActivity("newer", 900, 0), liveSessions: 2 };
    const out = sortProjects([older, newer], "recent");
    expect(out.map((p) => p.name)).toEqual(["newer", "older"]);
  });

  test("running: equal live-session counts fall back to lastActivity", () => {
    const older = { ...withActivity("older", 100, 0), liveSessions: 2 };
    const newer = { ...withActivity("newer", 900, 0), liveSessions: 2 };
    const out = sortProjects([older, newer], "running");
    expect(out.map((p) => p.name)).toEqual(["newer", "older"]);
  });
});

describe("matchesQuery", () => {
  test("case-insensitive substring on name", () => {
    expect(matchesQuery(proj({ name: "Forest" }), "ore")).toBe(true);
    expect(matchesQuery(proj({ name: "Forest" }), "REST")).toBe(true);
    expect(matchesQuery(proj({ name: "Forest" }), "xyz")).toBe(false);
  });
  test("empty/whitespace query matches everything", () => {
    expect(matchesQuery(proj({ name: "anything" }), "")).toBe(true);
    expect(matchesQuery(proj({ name: "anything" }), "   ")).toBe(true);
  });
});

describe("searchProjects", () => {
  test("merges visible + archived, filters by name, applies sort", () => {
    const visible = [proj({ name: "forest" }), proj({ name: "garden" })];
    const archived = [proj({ name: "old-forest", hidden: true })];
    const out = searchProjects(visible, archived, "forest", "name");
    expect(out.map((p) => p.name)).toEqual(["forest", "old-forest"]);
  });

  test("forwards the sort argument", () => {
    const visible = [
      { ...proj({ name: "idle" }) },
      { ...proj({ name: "busy" }), liveSessions: 3 },
    ];
    const out = searchProjects(visible, [], "", "running");
    expect(out.map((p) => p.name)).toEqual(["busy", "idle"]);
  });
});
