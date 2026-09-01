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
});
