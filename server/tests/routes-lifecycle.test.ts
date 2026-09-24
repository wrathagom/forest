// server/tests/routes-lifecycle.test.ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { LifecycleRegistry } from "../src/lifecycle/registry";
import { lifecycleRoutes } from "../src/routes/lifecycle";

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string>) {
  return { db, log: () => {}, loop: { refresh: async () => null } as never, url: new URL(request.url), params, request };
}

function deps(overrides: Partial<Parameters<typeof lifecycleRoutes>[0]> = {}) {
  return {
    registry: new LifecycleRegistry(),
    readConfig: () => ({ start: "make up", stop: "make down", health: "true" }),
    runCommand: async () => ({ exitCode: 0, output: "ok", timedOut: false }),
    ...overrides,
  };
}

function route(routes: ReturnType<typeof lifecycleRoutes>, method: string, suffix: RegExp) {
  return routes.find((r) => r.method === method && r.pattern.source.includes(suffix.source))!;
}

const sectionedConfig = () => ({
  start: "make up",
  sections: {
    game: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" },
    editor: { start: "godot --editor ." }, // launcher, no health
  },
});

async function enable(routes: ReturnType<typeof lifecycleRoutes>, db: ReturnType<typeof openDb>, id: string) {
  const e = route(routes, "POST", /lifecycle\/enable$/);
  await e.handler(ctx(db, new Request("http://x/e", { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
}

describe("lifecycle routes", () => {
  test("GET returns config, enabled flag, and status", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    const body = await res.json();
    expect(body.hasConfig).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.config).toEqual({ start: "make up", stop: "make down", health: "true" });
  });

  test("GET reports a parse error from a broken forest.yaml", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(
      deps({ readConfigResult: () => ({ config: null, parseError: "YAML Parse error: Unexpected token" }) }),
    );
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    const body = await res.json();
    expect(body.hasConfig).toBe(false);
    expect(body.parseError).toBe("YAML Parse error: Unexpected token");
  });

  test("enable toggles the flag", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const enable = route(routes, "POST", /lifecycle\/enable$/);
    const req = new Request(`http://x/api/projects/${id}/lifecycle/enable`, { method: "POST", body: JSON.stringify({ enabled: true }) });
    const res = await enable.handler(ctx(db, req, { id }) as never);
    expect((await res.json()).enabled).toBe(true);
  });

  test("start refuses when not enabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const start = route(routes, "POST", /lifecycle\/start$/);
    const res = await start.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle/start`, { method: "POST" }), { id }) as never);
    expect(res.status).toBe(400);
  });

  test("start runs the command when enabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    // enable first
    const enable = route(routes, "POST", /lifecycle\/enable$/);
    await enable.handler(ctx(db, new Request(`http://x/e`, { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
    const start = route(routes, "POST", /lifecycle\/start$/);
    const res = await start.handler(ctx(db, new Request(`http://x/s`, { method: "POST" }), { id }) as never);
    const body = await res.json();
    expect(body.exitCode).toBe(0);
    expect(body.output).toBe("ok");
  });

  test("start refuses when the command is absent", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: () => ({ stop: "make down" }) }));
    const enable = route(routes, "POST", /lifecycle\/enable$/);
    await enable.handler(ctx(db, new Request(`http://x/e`, { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
    const start = route(routes, "POST", /lifecycle\/start$/);
    const res = await start.handler(ctx(db, new Request(`http://x/s`, { method: "POST" }), { id }) as never);
    expect(res.status).toBe(400);
  });

  test("404 for an unknown project", async () => {
    const db = openDb(":memory:");
    const routes = lifecycleRoutes(deps());
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/nope/lifecycle`), { id: "nope" }) as never);
    expect(res.status).toBe(404);
  });

  test("GET status reflects the last stored snapshot", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    // simulate a scan having stored a healthy lifecycle status
    const { upsertSnapshot } = await import("../src/store/snapshots");
    const { emptySnapshot } = await import("../src/scanner/types");
    const snap = emptySnapshot();
    snap.lifecycle = { status: "healthy", hasConfig: true, enabled: true, health: { exitCode: 0 } };
    upsertSnapshot(db, id, snap);
    const routes = lifecycleRoutes(deps());
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    expect((await res.json()).status).toBe("healthy");
  });

  test("a transient status overrides the stored snapshot", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const d = deps();
    d.registry.setTransient(id, "starting");
    const routes = lifecycleRoutes(d);
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    expect((await res.json()).status).toBe("starting");
  });

  test("start returns 409 when a command is already in flight", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const d = deps();
    const routes = lifecycleRoutes(d);
    const enable = route(routes, "POST", /lifecycle\/enable$/);
    await enable.handler(ctx(db, new Request(`http://x/e`, { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
    d.registry.setTransient(id, "starting"); // simulate an in-flight command
    const start = route(routes, "POST", /lifecycle\/start$/);
    const res = await start.handler(ctx(db, new Request(`http://x/s`, { method: "POST" }), { id }) as never);
    expect(res.status).toBe(409);
  });

  test("GET view includes sections with computed status and lastRun", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const runCommand = async (cmd: string) => ({ exitCode: cmd.includes("pgrep") ? 0 : 0, output: "", timedOut: false });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
    await enable(routes, db, id);
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    const body = await res.json();
    const byName = Object.fromEntries(body.sections.map((s: { name: string }) => [s.name, s]));
    expect(byName.game.status).toBe("healthy");
    expect(byName.game.config.url).toBe("http://localhost:8060");
    expect(byName.game.lastRun).toBeNull();
    expect(byName.editor.status).toBe("none");
  });

  test("section status reflects a nonzero health as stopped", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const runCommand = async () => ({ exitCode: 1, output: "", timedOut: false });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
    await enable(routes, db, id);
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/g`), { id }) as never);
    const body = await res.json();
    const game = body.sections.find((s: { name: string }) => s.name === "game");
    expect(game.status).toBe("stopped");
  });

  test("section start runs the section command when enabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
    await enable(routes, db, id);
    const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
    const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
    const body = await res.json();
    expect(body.exitCode).toBe(0);
    expect(body.output).toBe("ok");
  });

  test("section start 404s for an unknown section", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
    await enable(routes, db, id);
    const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
    const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "nope" }) as never);
    expect(res.status).toBe(404);
  });

  test("section stop 400s when the section lacks a stop command", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
    await enable(routes, db, id);
    const stop = route(routes, "POST", /sections\/([^/]+)\/stop$/);
    const res = await stop.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "editor" }) as never);
    expect(res.status).toBe(400);
  });

  test("section start 400s when lifecycle is disabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
    const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
    const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
    expect(res.status).toBe(400);
  });

  test("a section in flight 409s only that section, not another", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const d = deps({ readConfig: sectionedConfig });
    const routes = lifecycleRoutes(d);
    await enable(routes, db, id);
    d.registry.setTransient(id, "starting", "game"); // game busy
    const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
    const busy = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
    expect(busy.status).toBe(409);
    const other = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "editor" }) as never);
    expect(other.status).toBe(200);
  });

  test("does not run section health when lifecycle is disabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    let calls = 0;
    const runCommand = async () => { calls++; return { exitCode: 0, output: "", timedOut: false }; };
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/g`), { id }) as never);
    const body = await res.json();
    const game = body.sections.find((s: { name: string }) => s.name === "game");
    expect(game.status).toBe("none");
    expect(calls).toBe(0); // no shell execution for a not-enabled project
  });

  test("GET uses the section transient and skips its health while in flight", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    let calls = 0;
    const runCommand = async () => { calls++; return { exitCode: 0, output: "", timedOut: false }; };
    const d = deps({ readConfig: sectionedConfig, runCommand });
    const routes = lifecycleRoutes(d);
    await enable(routes, db, id);
    calls = 0; // ignore the health probe triggered by enable()'s own view()
    d.registry.setTransient(id, "starting", "game");
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/g`), { id }) as never);
    const body = await res.json();
    const game = body.sections.find((s: { name: string }) => s.name === "game");
    expect(game.status).toBe("starting");
    expect(calls).toBe(0); // health not probed for the in-flight section
  });

  test("a throwing section health command yields stopped, not a crash", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const runCommand = async () => { throw new Error("boom"); };
    const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
    await enable(routes, db, id);
    const get = route(routes, "GET", /lifecycle$/);
    const res = await get.handler(ctx(db, new Request(`http://x/g`), { id }) as never);
    const body = await res.json();
    const game = body.sections.find((s: { name: string }) => s.name === "game");
    expect(game.status).toBe("stopped");
  });
});
