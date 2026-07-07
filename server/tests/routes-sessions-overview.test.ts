import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { sessionsOverviewRoutes } from "../src/routes/sessions-overview";

function ctx(db: ReturnType<typeof openDb>, request: Request) {
  return { db, log: () => {}, loop: { start() {}, stop() {} } as never, url: new URL(request.url), params: {}, request };
}

function seed(db: ReturnType<typeof openDb>): Vault {
  const now = Date.now();
  db.query("INSERT INTO projects (id, path, name, pinned, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)").run("p1", "/p1", "Proj One", now, now);
  const v = new Vault(db);
  v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/p1", project_id: "p1", worktree_label: "main", last_activity: 10, first_user_msg: "hello", profile: "work", source: "scan" });
  v.upsertSession({ session_id: "s2", agent: "claude", cwd: "/elsewhere", project_id: null, worktree_label: null, last_activity: 5, first_user_msg: "orphan", source: "scan" });
  v.upsertMessages(
    [{ session_id: "s1", uuid: "u1", role: "assistant", content: "{}", timestamp: 10, model: null, input_tokens: 100, cache_create_tokens: null, cache_read_tokens: null, output_tokens: 20, stop_reason: null }],
    [{ uuid: "u1", text: "hello searchable" }],
  );
  return v;
}

describe("sessions-overview routes", () => {
  test("GET /api/sessions returns sessions + total, honours project filter", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions")));
    const body = (await res.json()) as { sessions: Array<{ session_id: string; input_tokens: number }>; total: number };
    expect(body.total).toBe(2);
    expect(body.sessions[0]!.session_id).toBe("s1");
    expect(body.sessions[0]!.input_tokens).toBe(100);

    const res2 = await route.handler(ctx(db, new Request("http://x/api/sessions?project=none")));
    const body2 = (await res2.json()) as { sessions: Array<{ session_id: string }>; total: number };
    expect(body2.total).toBe(1);
    expect(body2.sessions[0]!.session_id).toBe("s2");
  });

  test("GET /api/sessions?q= performs full-text search", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions?q=searchable")));
    const body = (await res.json()) as { sessions: Array<{ session_id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0]!.session_id).toBe("s1");
  });

  test("GET /api/sessions/stats returns charts + totals", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions/stats"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions/stats")));
    const body = (await res.json()) as {
      tokensOverTime: unknown[];
      tokensByProject: Array<{ projectId: string | null; sessions: number }>;
      totals: { sessions: number; input: number; output: number; cache: number };
    };
    expect(body.tokensOverTime).toHaveLength(30);
    expect(body.tokensByProject.map((r) => r.projectId).sort()).toEqual([null, "p1"]);
    expect(body.totals).toEqual({ sessions: 2, input: 100, output: 20, cache: 0 });
  });

  test("GET /api/sessions/stats returns tokensByProfile + profiles", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions/stats"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions/stats")));
    const body = (await res.json()) as { tokensByProfile: Array<{ profile: string; sessions: number }>; profiles: string[] };
    expect(body.profiles).toContain("work");
    expect(body.tokensByProfile.find((r) => r.profile === "work")!.sessions).toBe(1);
  });

  test("GET /api/sessions?profile= filters by profile", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions?profile=work")));
    const body = (await res.json()) as { sessions: Array<{ session_id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0]!.session_id).toBe("s1");
  });
});
