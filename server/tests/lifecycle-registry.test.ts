// server/tests/lifecycle-registry.test.ts
import { describe, expect, test } from "bun:test";
import { LifecycleRegistry } from "../src/lifecycle/registry";

describe("LifecycleRegistry", () => {
  test("tracks a transient status and clears it", () => {
    const reg = new LifecycleRegistry();
    expect(reg.transient("p1")).toBeNull();
    reg.setTransient("p1", "starting");
    expect(reg.transient("p1")).toBe("starting");
    reg.clearTransient("p1");
    expect(reg.transient("p1")).toBeNull();
  });

  test("records and returns the last run", () => {
    const reg = new LifecycleRegistry();
    reg.setLastRun("p1", { kind: "start", exitCode: 0, output: "up", at: 123, failed: false });
    expect(reg.lastRun("p1")).toEqual({ kind: "start", exitCode: 0, output: "up", at: 123, failed: false });
    expect(reg.lastRun("p2")).toBeNull();
  });

  test("reports whether a project has a command in flight", () => {
    const reg = new LifecycleRegistry();
    expect(reg.inFlight("p1")).toBe(false);
    reg.setTransient("p1", "stopping");
    expect(reg.inFlight("p1")).toBe(true);
  });

  test("keys transient state per section, independent of the top level", () => {
    const reg = new LifecycleRegistry();
    reg.setTransient("p1", "starting", "game");
    expect(reg.transient("p1", "game")).toBe("starting");
    expect(reg.transient("p1")).toBeNull();          // top level unaffected
    expect(reg.transient("p1", "editor")).toBeNull(); // other section unaffected
    expect(reg.inFlight("p1", "game")).toBe(true);
    expect(reg.inFlight("p1")).toBe(false);
    reg.clearTransient("p1", "game");
    expect(reg.transient("p1", "game")).toBeNull();
  });

  test("keys last-run per section", () => {
    const reg = new LifecycleRegistry();
    const run = { kind: "start", exitCode: 0, output: "up", at: 1, failed: false } as const;
    reg.setLastRun("p1", run, "game");
    expect(reg.lastRun("p1", "game")).toEqual(run);
    expect(reg.lastRun("p1")).toBeNull(); // top level has its own slot
  });
});
