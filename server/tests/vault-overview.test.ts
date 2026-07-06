import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";

const dayMs = 86_400_000;
function utcMidnightToday(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function msg(
  session_id: string,
  uuid: string,
  timestamp: number,
  tok: Partial<{ input: number; output: number; cacheCreate: number; cacheRead: number }> = {},
) {
  return {
    session_id,
    uuid,
    role: "assistant",
    content: "{}",
    timestamp,
    model: null,
    input_tokens: tok.input ?? null,
    cache_create_tokens: tok.cacheCreate ?? null,
    cache_read_tokens: tok.cacheRead ?? null,
    output_tokens: tok.output ?? null,
    stop_reason: null,
  };
}

function seedTwoProjects(db: ReturnType<typeof openDb>): Vault {
  const now = Date.now();
  db.query(
    "INSERT INTO projects (id, path, name, pinned, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)",
  ).run("p1", "/tmp/p1", "Project One", now, now);
  db.query(
    "INSERT INTO projects (id, path, name, pinned, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)",
  ).run("p2", "/tmp/p2", "Project Two", now, now);
  const v = new Vault(db);
  v.upsertSession({ session_id: "sid-A", agent: "claude", cwd: "/tmp/p1", project_id: "p1", worktree_label: "main", last_activity: 5, first_user_msg: "alpha", source: "scan" });
  v.upsertSession({ session_id: "sid-B", agent: "claude", cwd: "/tmp/p1/x", project_id: "p1", worktree_label: "wt", last_activity: 10, first_user_msg: "beta", source: "scan" });
  v.upsertSession({ session_id: "sid-C", agent: "claude", cwd: "/tmp/p2", project_id: "p2", worktree_label: "main", last_activity: 7, first_user_msg: "gamma", source: "scan" });
  v.upsertSession({ session_id: "sid-D", agent: "claude", cwd: "/tmp/elsewhere", project_id: null, worktree_label: null, last_activity: 3, first_user_msg: "delta", source: "scan" });
  v.upsertMessages([msg("sid-A", "ua", 5, { input: 100, output: 50, cacheRead: 200 })], [{ uuid: "ua", text: "alpha unique words" }]);
  v.upsertMessages([msg("sid-B", "ub", 10, { input: 10, output: 5 })], [{ uuid: "ub", text: "beta unique words" }]);
  v.upsertMessages([msg("sid-C", "uc", 7, { input: 1000 })], [{ uuid: "uc", text: "gamma unique words" }]);
  v.upsertMessages([msg("sid-D", "ud", 3, { input: 1 })], [{ uuid: "ud", text: "delta unique words" }]);
  return v;
}

describe("Vault.tokensByProject", () => {
  test("aggregates per project + unassigned bucket, sorted by total desc", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    const rows = v.tokensByProject();
    expect(rows.map((r) => r.projectId)).toEqual(["p2", "p1", null]);
    expect(rows[0]).toEqual({ projectId: "p2", projectName: "Project Two", input: 1000, output: 0, cache: 0, sessions: 1 });
    expect(rows[1]).toEqual({ projectId: "p1", projectName: "Project One", input: 110, output: 55, cache: 200, sessions: 2 });
    expect(rows[2]).toEqual({ projectId: null, projectName: "unassigned", input: 1, output: 0, cache: 0, sessions: 1 });
  });
});

describe("Vault.listAll", () => {
  test("lists all sessions across projects with token totals and project name, sorted by last_activity desc", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    const { sessions, total } = v.listAll({});
    expect(total).toBe(4);
    expect(sessions.map((s) => s.session_id)).toEqual(["sid-B", "sid-C", "sid-A", "sid-D"]);
    const a = sessions.find((s) => s.session_id === "sid-A")!;
    expect(a.project_name).toBe("Project One");
    expect(a.input_tokens).toBe(100);
    expect(a.output_tokens).toBe(50);
    expect(a.cache_tokens).toBe(200);
    const d = sessions.find((s) => s.session_id === "sid-D")!;
    expect(d.project_name).toBeNull();
  });

  test("filters by projectId, and projectId 'none' returns unassigned only", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    expect(v.listAll({ projectId: "p1" }).sessions.map((s) => s.session_id)).toEqual(["sid-B", "sid-A"]);
    expect(v.listAll({ projectId: "p1" }).total).toBe(2);
    expect(v.listAll({ projectId: "none" }).sessions.map((s) => s.session_id)).toEqual(["sid-D"]);
    expect(v.listAll({ projectId: "none" }).total).toBe(1);
  });

  test("sorts by token total descending", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    const { sessions } = v.listAll({ sort: "tokens", dir: "desc" });
    expect(sessions.map((s) => s.session_id)).toEqual(["sid-C", "sid-A", "sid-B", "sid-D"]);
  });

  test("FTS search filters to matching sessions and attaches a snippet", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    const { sessions, total } = v.listAll({ q: "alpha" });
    expect(total).toBe(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.session_id).toBe("sid-A");
    expect(sessions[0]!.snippet).toContain("alpha");
  });

  test("malformed FTS query yields an empty result instead of throwing", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    expect(v.listAll({ q: 'oops"unbalanced' })).toEqual({ sessions: [], total: 0 });
  });

  test("paginates with limit/offset", () => {
    const db = openDb(":memory:");
    const v = seedTwoProjects(db);
    const page1 = v.listAll({ limit: 2, offset: 0 });
    const page2 = v.listAll({ limit: 2, offset: 2 });
    expect(page1.sessions.map((s) => s.session_id)).toEqual(["sid-B", "sid-C"]);
    expect(page2.sessions.map((s) => s.session_id)).toEqual(["sid-A", "sid-D"]);
    expect(page1.total).toBe(4);
  });
});

describe("Vault.tokensByProfile", () => {
  test("aggregates per profile, keeping null (unassigned) and 'default' distinct, sorted by total desc", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "sp1", agent: "claude", cwd: "/a", last_activity: 1, profile: "personal", source: "scan" });
    v.upsertSession({ session_id: "sp2", agent: "claude", cwd: "/b", last_activity: 2, profile: "work", source: "scan" });
    v.upsertSession({ session_id: "sp3", agent: "claude", cwd: "/c", last_activity: 3, profile: "default", source: "scan" });
    v.upsertSession({ session_id: "sp4", agent: "claude", cwd: "/d", last_activity: 4, source: "scan" }); // null profile
    v.upsertMessages([msg("sp1", "m1", 1, { input: 50, output: 10 })], [{ uuid: "m1", text: "x" }]);
    v.upsertMessages([msg("sp2", "m2", 2, { input: 1000, output: 0 })], [{ uuid: "m2", text: "y" }]);
    v.upsertMessages([msg("sp3", "m3", 3, { input: 5, output: 0 })], [{ uuid: "m3", text: "z" }]);
    v.upsertMessages([msg("sp4", "m4", 4, { input: 1, output: 0 })], [{ uuid: "m4", text: "w" }]);
    const rows = v.tokensByProfile();
    expect(rows.map((r) => r.profile)).toEqual(["work", "personal", "default", "unassigned"]);
    expect(rows.find((r) => r.profile === "personal")).toEqual({ profile: "personal", input: 50, output: 10, cache: 0, sessions: 1 });
    expect(rows.find((r) => r.profile === "unassigned")).toEqual({ profile: "unassigned", input: 1, output: 0, cache: 0, sessions: 1 });
  });
});

describe("Vault.tokensOverTime", () => {
  test("buckets by UTC day over the last N days, zero-filling and excluding older messages", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/tmp/p", last_activity: 1, source: "scan" });
    const today = utcMidnightToday();
    v.upsertMessages([msg("s1", "u1", today + 3_600_000, { input: 100, output: 10 })], []);
    v.upsertMessages([msg("s1", "u2", today - dayMs + 3_600_000, { cacheRead: 200, cacheCreate: 5 })], []);
    v.upsertMessages([msg("s1", "u3", today - 40 * dayMs, { input: 999 })], []); // outside a 7-day window

    const out = v.tokensOverTime({ days: 7 });
    expect(out).toHaveLength(7);
    expect(out[6]).toEqual({ day: dayKey(today), input: 100, output: 10, cache: 0 });
    expect(out[5]).toEqual({ day: dayKey(today - dayMs), input: 0, output: 0, cache: 205 });
    expect(out[0]).toEqual({ day: dayKey(today - 6 * dayMs), input: 0, output: 0, cache: 0 });
    // the 40-days-ago message must not appear anywhere
    expect(out.some((p) => p.input === 999)).toBe(false);
  });
});
