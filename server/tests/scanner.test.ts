import { describe, expect, test } from "bun:test";
import { scanProject } from "../src/scanner";
import type { Probes, Snapshot } from "../src/scanner/types";

const okProbes: Probes = {
  git: async () => ({ branch: "main", dirty: true, changed: 2, ahead: 0, behind: 0, lastCommit: null, lastEdit: 123 }),
  docker: async () => ({ services: [{ name: "db", state: "running", from: "compose" }] }),
  processes: async () => ({ processes: [{ pid: 1, command: "vite", cwd: "/x" }] }),
};

describe("scanProject", () => {
  test("merges all three probes into one snapshot", async () => {
    const snap = await scanProject("/x", okProbes);
    expect(snap.git.branch).toBe("main");
    expect(snap.lastEdit).toBe(123);
    expect(snap.services.docker[0]?.name).toBe("db");
    expect(snap.services.processes[0]?.pid).toBe(1);
    expect(snap.errors).toEqual([]);
  });

  test("isolates a failing probe to its slice", async () => {
    const broken: Probes = {
      ...okProbes,
      docker: async () => {
        throw new Error("daemon down");
      },
    };
    const snap = await scanProject("/x", broken);
    expect(snap.git.branch).toBe("main");
    expect(snap.services.docker).toEqual([]);
    expect(snap.errors.some((e) => e.includes("docker"))).toBe(true);
  });

  test("times out a slow probe", async () => {
    const slow: Probes = {
      ...okProbes,
      git: (_, signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const snap = await scanProject("/x", slow, { timeoutMs: 50 });
    expect(snap.errors.some((e) => e.includes("timed out"))).toBe(true);
    expect(snap.services.processes[0]?.pid).toBe(1);
  });
});
