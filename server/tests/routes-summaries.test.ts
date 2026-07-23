import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { agentSessionsRoutes } from "../src/routes/agent-sessions";
import type { SummaryStatus } from "../src/sessions/summarizer";
import { startServer } from "../src/server";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";

let vault: Vault;

beforeEach(() => {
  vault = new Vault(openDb(":memory:"));
});

const stub = {
  status: (): SummaryStatus => ({ status: "ready", summary: "cached", moments: [], stale: false }),
  request: async (_sid: string, opts?: { force?: boolean }): Promise<SummaryStatus> =>
    ({ status: opts?.force ? "ready" : "pending" }),
};

function routes(summarizer: unknown = stub) {
  return agentSessionsRoutes({
    vault,
    listProjects: () => [],
    claudeConfigDirs: () => [],
    summarizer: summarizer as never,
  });
}

function ctx(sid: string, init?: RequestInit) {
  const url = `http://x/api/agent-sessions/${sid}/summary`;
  return {
    params: { sid },
    url: new URL(url),
    request: new Request(url, init),
    db: null as never,
    log: () => {},
  } as never;
}

function find(method: string, path: string) {
  const route = routes().find((r) => r.method === method && r.pattern.test(path));
  if (!route) throw new Error(`no ${method} route for ${path}`);
  return route;
}

describe("summary routes", () => {
  test("the summary route is registered before the :sid catch-all", () => {
    const all = routes();
    const idx = all.findIndex((r) => r.method === "GET" && r.pattern.source.includes("summary"));
    const catchAll = all.findIndex(
      (r) => r.method === "GET" && r.pattern.source === "^\\/api\\/agent-sessions\\/([^/]+)$",
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(catchAll);
  });

  test("GET returns the stored status", async () => {
    const res = await find("GET", "/api/agent-sessions/s1/summary").handler(ctx("s1"));
    expect(await res.json()).toMatchObject({ status: "ready", summary: "cached" });
  });

  test("POST enqueues and returns pending", async () => {
    const res = await find("POST", "/api/agent-sessions/s1/summary").handler(
      ctx("s1", { method: "POST", body: "{}" }),
    );
    expect(await res.json()).toMatchObject({ status: "pending" });
  });

  test("POST honours force", async () => {
    const res = await find("POST", "/api/agent-sessions/s1/summary").handler(
      ctx("s1", { method: "POST", body: JSON.stringify({ force: true }) }),
    );
    expect(await res.json()).toMatchObject({ status: "ready" });
  });

  test("POST with no body does not throw", async () => {
    const res = await find("POST", "/api/agent-sessions/s1/summary").handler(
      ctx("s1", { method: "POST" }),
    );
    expect(await res.json()).toMatchObject({ status: "pending" });
  });

  test("without a summarizer configured, GET reports absent", async () => {
    const route = agentSessionsRoutes({ vault, listProjects: () => [], claudeConfigDirs: () => [] })
      .find((r) => r.method === "GET" && r.pattern.source.includes("summary"))!;
    const res = await route.handler(ctx("s1"));
    expect(await res.json()).toMatchObject({ status: "absent" });
  });
});

// --- Real dispatch layer -----------------------------------------------
//
// The test above compares array indices, which is only a meaningful proxy if
// server.ts's fetch handler actually walks `routes` in order and returns on
// the first pattern match (it does — see `for (const r of routes) { ... if
// (m) ... return handler }` in src/server.ts). This block proves that same
// claim end-to-end over real HTTP against a real Bun.serve instance wired
// with agentSessionsRoutes exactly as index.ts wires it, so a regression in
// route order (or in server.ts's matching loop) would fail here even if it
// somehow left the array-index test passing.
describe("summary routes — real dispatch over HTTP", () => {
  const db = openDb(":memory:");
  const loop = createLoop({
    intervalMs: 60_000,
    listVisible: () => [],
    scanProject: async () => emptySnapshot(),
    onSnapshot: () => {},
    log: () => {},
  });
  const httpVault = new Vault(db);
  // Seed a real session row so GET /:sid (the catch-all) would return 200 with
  // a session detail body if it wrongly won the match — distinguishable from
  // the summary route's `{ status: ... }` shape.
  httpVault.upsertSession({
    session_id: "real-1",
    agent: "claude",
    cwd: "/tmp/proj",
    last_activity: 1,
    source: "scan",
  });

  const server = startServer({
    port: 0,
    db,
    loop,
    log: () => {},
    routes: agentSessionsRoutes({
      vault: httpVault,
      listProjects: () => [],
      claudeConfigDirs: () => [],
      summarizer: stub as never,
    }),
  });
  const url = `http://${server.hostname}:${server.port}`;

  afterAll(() => server.stop(true));

  test("GET /api/agent-sessions/real-1/summary hits the summary handler, not the :sid catch-all", async () => {
    const res = await fetch(`${url}/api/agent-sessions/real-1/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The catch-all returns a session detail object (id/cwd/messageCount/...);
    // the summary route returns a SummaryStatus (status/summary/...). If the
    // catch-all had won, `status` would be absent and `session_id` present.
    expect(body.status).toBe("ready");
    expect(body.summary).toBe("cached");
    expect(body.session_id).toBeUndefined();
  });

  test("GET /api/agent-sessions/real-1 (no /summary) still reaches the catch-all detail route", async () => {
    const res = await fetch(`${url}/api/agent-sessions/real-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeUndefined();
  });

  test("POST /api/agent-sessions/real-1/summary hits the summary handler", async () => {
    const res = await fetch(`${url}/api/agent-sessions/real-1/summary`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
  });
});
