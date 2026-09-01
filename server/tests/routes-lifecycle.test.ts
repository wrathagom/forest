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
});
