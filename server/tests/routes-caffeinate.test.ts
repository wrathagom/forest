import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { caffeinateRoutes } from "../src/routes/caffeinate";
import { createCaffeinate, type SpawnedChild } from "../src/caffeinate";

function makeFakeSpawn() {
  const spawned: Array<SpawnedChild & { killed: boolean; exitCb: (() => void) | null }> = [];
  const spawn = () => {
    const c = {
      killed: false,
      exitCb: null as (() => void) | null,
      kill() { this.killed = true; },
      onExit(cb: () => void) { this.exitCb = cb; },
    };
    spawned.push(c);
    return c;
  };
  return { spawn, spawned };
}

function ctx(request: Request) {
  return {
    db: undefined as never,
    log: () => {},
    loop: { start() {}, stop() {} } as never,
    url: new URL(request.url),
    params: {},
    request,
  };
}

describe("GET /api/caffeinate", () => {
  test("returns current status (inactive)", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const get = routes.find((r) => r.method === "GET")!;
    const res = await get.handler(ctx(new Request("http://x/api/caffeinate")) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supported: true, active: false, endsAt: null, indefinite: false });
  });

  test("returns supported: false on non-darwin", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "linux" });
    const routes = caffeinateRoutes(c);
    const get = routes.find((r) => r.method === "GET")!;
    const res = await get.handler(ctx(new Request("http://x/api/caffeinate")) as never);
    const body = await res.json();
    expect(body.supported).toBe(false);
  });
});

describe("POST /api/caffeinate", () => {
  test("starts with a valid duration", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 1_000, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const post = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/caffeinate", {
      method: "POST",
      body: JSON.stringify({ durationSec: 3600 }),
      headers: { "content-type": "application/json" },
    });
    const res = await post.handler(ctx(req) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(body.endsAt).toBe(1_000 + 3600 * 1000);
  });

  test("starts indefinite with durationSec: null", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const post = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/caffeinate", {
      method: "POST",
      body: JSON.stringify({ durationSec: null }),
      headers: { "content-type": "application/json" },
    });
    const res = await post.handler(ctx(req) as never);
    const body = await res.json();
    expect(body.indefinite).toBe(true);
  });

  test("rejects a non-allowlisted duration", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const post = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/caffeinate", {
      method: "POST",
      body: JSON.stringify({ durationSec: 60 }),
      headers: { "content-type": "application/json" },
    });
    const res = await post.handler(ctx(req) as never);
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON body", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const post = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/caffeinate", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const res = await post.handler(ctx(req) as never);
    expect(res.status).toBe(400);
  });

  test("returns 400 on unsupported platform", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "linux" });
    const routes = caffeinateRoutes(c);
    const post = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/caffeinate", {
      method: "POST",
      body: JSON.stringify({ durationSec: 3600 }),
      headers: { "content-type": "application/json" },
    });
    const res = await post.handler(ctx(req) as never);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/caffeinate", () => {
  test("stops an active run and returns inactive status", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    c.start(3600);
    const routes = caffeinateRoutes(c);
    const del = routes.find((r) => r.method === "DELETE")!;
    const res = await del.handler(ctx(new Request("http://x/api/caffeinate", { method: "DELETE" })) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
  });

  test("is idempotent when already inactive", async () => {
    const db = openDb(":memory:");
    const c = createCaffeinate({ db, spawn: makeFakeSpawn().spawn, now: () => 0, platform: "darwin" });
    const routes = caffeinateRoutes(c);
    const del = routes.find((r) => r.method === "DELETE")!;
    const res = await del.handler(ctx(new Request("http://x/api/caffeinate", { method: "DELETE" })) as never);
    expect(res.status).toBe(200);
  });
});
