// server/tests/lifecycle-status.test.ts
import { describe, expect, test } from "bun:test";
import { computeLifecycle } from "../src/lifecycle/status";

describe("computeLifecycle", () => {
  test("not enabled -> none (even with a config and services up)", () => {
    expect(computeLifecycle({ enabled: false, hasConfig: true, servicesUp: true, health: { exitCode: 0 } })).toBe("none");
  });

  test("enabled but no config -> none", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: false, servicesUp: false, health: null })).toBe("none");
  });

  test("enabled, nothing up -> stopped", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: false, health: null })).toBe("stopped");
  });

  test("enabled, up, no health run -> running", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: null })).toBe("running");
  });

  test("enabled, up, health exit 0 -> healthy", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: { exitCode: 0 } })).toBe("healthy");
  });

  test("enabled, up, health nonzero -> errors", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: { exitCode: 1 } })).toBe("errors");
  });
});
