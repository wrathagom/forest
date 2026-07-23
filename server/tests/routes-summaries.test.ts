import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { agentSessionsRoutes } from "../src/routes/agent-sessions";
import { SessionSummarizer, type SummaryStatus } from "../src/sessions/summarizer";
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
  // The summary routes are NOT order-sensitive (unlike /live, whose path really
  // does match the catch-all): `([^/]+)` excludes `/`, so the catch-all cannot
  // claim a two-segment path. Assert the dispatch fact instead of an ordering
  // that has no effect — the previous version of this test compared array
  // indices for a collision that cannot happen.
  test("only the summary route matches a /:sid/summary path", () => {
    const all = routes();
    const matching = (path: string) =>
      all.filter((r) => r.method === "GET" && r.pattern.test(path)).map((r) => r.pattern.source);
    expect(matching("/api/agent-sessions/s1/summary")).toEqual([
      "^\\/api\\/agent-sessions\\/([^/]+)\\/summary$",
    ]);
    expect(matching("/api/agent-sessions/s1")).toEqual([
      "^\\/api\\/agent-sessions\\/([^/]+)$",
    ]);
  });

  test("GET returns the stored status", async () => {
    const res = await find("GET", "/api/agent-sessions/s1/summary").handler(ctx("s1"));
    expect(await res.json()).toMatchObject({ status: "ready", summary: "cached" });
  });

  // The real thing, not the stub: POST must return before the ~18s run
  // finishes. A stub that returns `pending` would pass either way.
  test("POST admits the run and returns pending without waiting for it", async () => {
    const db = openDb(":memory:");
    const realVault = new Vault(db);
    realVault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "default",
    });
    realVault.upsertMessages(
      Array.from({ length: 8 }, (_, i) => ({
        session_id: "s1", uuid: `u${i}`, role: i % 2 ? "assistant" : "user",
        content: JSON.stringify({ type: "user", message: { role: "user", content: `msg ${i}` } }),
        timestamp: i, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null,
      })),
      [],
    );
    let released!: (v: { code: number; stdout: string; stderr: string }) => void;
    const summarizer = new SessionSummarizer({
      vault: realVault,
      dataDir: "/data",
      claudeConfigDirs: () => [{ path: "/home/u/.claude", profile: "default" }],
      // Stands in for the ~18s run: it does not finish on its own.
      spawn: () => ({
        exited: new Promise((r) => { released = r; }),
        kill: () => {},
      }),
    });
    const route = agentSessionsRoutes({
      vault: realVault, listProjects: () => [], claudeConfigDirs: () => [], summarizer,
    }).find((r) => r.method === "POST" && r.pattern.source.includes("summary"))!;

    const started = Date.now();
    const res = await route.handler(ctx("s1", { method: "POST", body: "{}" }));
    expect(Date.now() - started).toBeLessThan(100);
    expect(await res.json()).toMatchObject({ status: "pending" });
    // Still pending afterwards — the run really is still going.
    expect(summarizer.status("s1").status).toBe("pending");

    released({
      code: 0,
      stdout: JSON.stringify({
        type: "result", subtype: "success", is_error: false,
        result: '{"summary":"done","moments":[]}',
      }),
      stderr: "",
    });
    await summarizer.idle();
    expect(summarizer.status("s1").status).toBe("ready");
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
// The test above reasons about patterns in isolation. This block proves the
// same claim end-to-end over real HTTP against a real Bun.serve instance wired
// with agentSessionsRoutes exactly as index.ts wires it: each of the three
// paths reaches the handler it should, whatever server.ts's matching loop does
// with the array. A regression that routed /:sid/summary to the session-detail
// handler (say, by loosening `([^/]+)`) fails here.
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
