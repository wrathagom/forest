import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { createCaffeinate, type SpawnedChild } from "../src/caffeinate";
import { getCaffeinateState, setCaffeinateState } from "../src/store/config";

type FakeChild = SpawnedChild & {
  killed: boolean;
  exitCb: (() => void) | null;
};

function makeFakeSpawn() {
  const spawned: FakeChild[] = [];
  const spawn = () => {
    const c: FakeChild = {
      killed: false,
      exitCb: null,
      kill() { this.killed = true; this.exitCb?.(); },
      onExit(cb) { this.exitCb = cb; },
    };
    spawned.push(c);
    return c;
  };
  return { spawn, spawned };
}

describe("caffeinate controller — platform gating", () => {
  test("status reports unsupported on non-darwin", () => {
    const db = openDb(":memory:");
    const { spawn } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "linux" });
    expect(c.status()).toEqual({ supported: false, active: false, endsAt: null, indefinite: false });
  });

  test("start throws on unsupported platform", () => {
    const db = openDb(":memory:");
    const { spawn } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "linux" });
    expect(() => c.start(3600)).toThrow(/not supported/i);
  });
});

describe("caffeinate controller — start/stop", () => {
  test("start spawns caffeinate and reports active", () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 1_000, platform: "darwin" });
    const s = c.start(3600);
    expect(spawned).toHaveLength(1);
    expect(s.active).toBe(true);
    expect(s.endsAt).toBe(1_000 + 3600 * 1000);
    expect(s.indefinite).toBe(false);
  });

  test("indefinite start has null endsAt", () => {
    const db = openDb(":memory:");
    const { spawn } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    const s = c.start(null);
    expect(s.active).toBe(true);
    expect(s.endsAt).toBeNull();
    expect(s.indefinite).toBe(true);
  });

  test("stop kills the child and clears state", () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    c.start(3600);
    c.stop();
    expect(spawned[0]!.killed).toBe(true);
    expect(c.status().active).toBe(false);
    expect(getCaffeinateState(db)).toBeNull();
  });

  test("starting while active replaces the existing child", () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    c.start(3600);
    c.start(7200);
    expect(spawned).toHaveLength(2);
    expect(spawned[0]!.killed).toBe(true);
    expect(spawned[1]!.killed).toBe(false);
  });

  test("child exit clears in-memory and persisted state", () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    c.start(3600);
    // Simulate external kill: invoke exit callback without going through stop().
    spawned[0]!.exitCb!();
    expect(c.status().active).toBe(false);
    expect(getCaffeinateState(db)).toBeNull();
  });

  test("persists state on start", () => {
    const db = openDb(":memory:");
    const { spawn } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 5_000, platform: "darwin" });
    c.start(3600);
    expect(getCaffeinateState(db)).toEqual({ startedAt: 5_000, durationSec: 3600 });
  });
});

describe("caffeinate controller — auto-expiry", () => {
  test("timer fires stop at endsAt", async () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    c.start(0); // 0 seconds → expires effectively immediately
    // setTimeout(..., 0) runs on the next tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(spawned[0]!.killed).toBe(true);
    expect(c.status().active).toBe(false);
  });
});

describe("caffeinate controller — init / resume", () => {
  test("init with no persisted state is a no-op", () => {
    const db = openDb(":memory:");
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "darwin" });
    c.init();
    expect(spawned).toHaveLength(0);
    expect(c.status().active).toBe(false);
  });

  test("init resumes an active timed run", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 1_000, durationSec: 3600 });
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 2_000, platform: "darwin" });
    c.init();
    expect(spawned).toHaveLength(1);
    expect(c.status().active).toBe(true);
    expect(c.status().endsAt).toBe(1_000 + 3600 * 1000);
  });

  test("init resumes an indefinite run", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 1_000, durationSec: null });
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 2_000, platform: "darwin" });
    c.init();
    expect(spawned).toHaveLength(1);
    expect(c.status().indefinite).toBe(true);
  });

  test("init clears expired state", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 1_000, durationSec: 1 }); // ends at 2_000
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 999_999, platform: "darwin" });
    c.init();
    expect(spawned).toHaveLength(0);
    expect(c.status().active).toBe(false);
    expect(getCaffeinateState(db)).toBeNull();
  });

  test("init does nothing on unsupported platform even if state is persisted", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 0, durationSec: 3600 });
    const { spawn, spawned } = makeFakeSpawn();
    const c = createCaffeinate({ db, spawn, now: () => 0, platform: "linux" });
    c.init();
    expect(spawned).toHaveLength(0);
  });
});
