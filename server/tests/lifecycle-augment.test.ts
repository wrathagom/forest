// server/tests/lifecycle-augment.test.ts
import { describe, expect, test } from "bun:test";
import { emptySnapshot } from "../src/scanner/types";
import { augmentWithLifecycle } from "../src/lifecycle/augment";

function upSnap() {
  const s = emptySnapshot();
  s.services.processes = [{ pid: 1, command: "node", cwd: "/x", ports: [3000] }];
  return s;
}

describe("augmentWithLifecycle", () => {
  test("not enabled -> none, health never runs", async () => {
    let ran = false;
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: false,
      config: { health: "true" },
      runHealth: async () => { ran = true; return { exitCode: 0 }; },
    });
    expect(s.lifecycle.status).toBe("none");
    expect(ran).toBe(false);
  });

  test("enabled + up + passing health -> healthy", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { health: "true" },
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle).toEqual({ status: "healthy", hasConfig: true, enabled: true, health: { exitCode: 0 } });
  });

  test("enabled + up + failing health -> errors", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { health: "false" },
      runHealth: async () => ({ exitCode: 1 }),
    });
    expect(s.lifecycle.status).toBe("errors");
  });

  test("enabled + nothing up -> stopped, health not run", async () => {
    let ran = false;
    const s = await augmentWithLifecycle(emptySnapshot(), {
      enabled: true,
      config: { health: "true" },
      runHealth: async () => { ran = true; return { exitCode: 0 }; },
    });
    expect(s.lifecycle.status).toBe("stopped");
    expect(ran).toBe(false);
  });

  test("enabled + up + no health command -> running", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { start: "make up" },
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle.status).toBe("running");
  });

  test("no config -> none", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: null,
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle.status).toBe("none");
  });

  test("enabled + docker container running counts as up -> healthy", async () => {
    const s = emptySnapshot();
    s.services.docker = [{ name: "web", state: "running", from: "compose" }];
    const out = await augmentWithLifecycle(s, {
      enabled: true,
      config: { health: "true" },
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(out.lifecycle.status).toBe("healthy");
  });

  test("a throwing health runner degrades to errors, not a rejection", async () => {
    const s = emptySnapshot();
    s.services.processes = [{ pid: 1, command: "node", cwd: "/x", ports: [3000] }];
    const out = await augmentWithLifecycle(s, {
      enabled: true,
      config: { health: "boom" },
      runHealth: async () => { throw new Error("spawn failed"); },
    });
    expect(out.lifecycle.status).toBe("errors");
  });
});
