import { describe, expect, test } from "bun:test";
import { probeProcesses, _internal } from "../src/scanner/processes";

describe("probeProcesses", () => {
  test("filters processes whose cwd is inside the project", async () => {
    const probe = probeProcesses({
      listProcesses: async () => [
        { pid: 1, command: "vite", cwd: "/proj/sub", ports: [5173] },
        { pid: 2, command: "node script.js", cwd: "/elsewhere", ports: [] },
        { pid: 3, command: "bash", cwd: "/proj", ports: [] },
      ],
    });
    const out = await probe("/proj", new AbortController().signal);
    expect(out.processes.map((p) => p.pid).sort()).toEqual([1, 3]);
    expect(out.processes.find((p) => p.pid === 1)?.cwd).toBe("/proj/sub");
    expect(out.processes.find((p) => p.pid === 1)?.ports).toEqual([5173]);
  });

  test("ignores processes whose cwd is null", async () => {
    const probe = probeProcesses({
      listProcesses: async () => [{ pid: 1, command: "x", cwd: null, ports: [] }],
    });
    const out = await probe("/proj", new AbortController().signal);
    expect(out.processes).toEqual([]);
  });

  test("excludes processes whose cwd matches a sibling path coincidentally", async () => {
    const probe = probeProcesses({
      listProcesses: async () => [{ pid: 1, command: "x", cwd: "/proj-other", ports: [] }],
    });
    const out = await probe("/proj", new AbortController().signal);
    expect(out.processes).toEqual([]);
  });

  test("ports default to empty when none are listening", async () => {
    const probe = probeProcesses({
      listProcesses: async () => [{ pid: 5, command: "bash", cwd: "/proj", ports: [] }],
    });
    const out = await probe("/proj", new AbortController().signal);
    expect(out.processes[0]?.ports).toEqual([]);
  });

  test("the default bulk scan is single-flighted across concurrent project scans", async () => {
    let calls = 0;
    let resolveScan!: (rows: { pid: number; command: string; cwd: string | null; ports: number[] }[]) => void;
    const probe = probeProcesses({
      cacheTtlMs: 1, // tiny TTL so this run doesn't leak into other tests
      bulkScan: () => {
        calls++;
        return new Promise((r) => {
          resolveScan = r;
        });
      },
    });
    const sig = new AbortController().signal;
    const p1 = probe("/a", sig);
    const p2 = probe("/b", sig);
    const p3 = probe("/c", sig);
    expect(calls).toBe(1); // all three coalesced onto one in-flight scan

    resolveScan([
      { pid: 1, command: "vite", cwd: "/a/sub", ports: [5173] },
      { pid: 2, command: "node", cwd: "/b", ports: [] },
    ]);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.processes.map((p) => p.pid)).toEqual([1]);
    expect(r2.processes.map((p) => p.pid)).toEqual([2]);
    expect(r3.processes).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("processes parser internals", () => {
  test("parseLsofPn groups names by pid", () => {
    const out = "p123\nn/Users/me/code\np456\nn/elsewhere\n";
    const seen: [number, string][] = [];
    _internal.parseLsofPn(out, (pid, name) => seen.push([pid, name]));
    expect(seen).toEqual([
      [123, "/Users/me/code"],
      [456, "/elsewhere"],
    ]);
  });

  test("parseLsofPn collects multiple ports per pid", () => {
    const out = "p7\nn*:3000\nn127.0.0.1:5173\np9\nn[::1]:8080\n";
    const ports = new Map<number, number[]>();
    _internal.parseLsofPn(out, (pid, name) => {
      const port = _internal.parsePort(name);
      if (port === null) return;
      const list = ports.get(pid) ?? [];
      list.push(port);
      ports.set(pid, list);
    });
    expect(ports.get(7)).toEqual([3000, 5173]);
    expect(ports.get(9)).toEqual([8080]);
  });

  test("parsePort handles standard host:port forms", () => {
    expect(_internal.parsePort("*:3000")).toBe(3000);
    expect(_internal.parsePort("127.0.0.1:5173")).toBe(5173);
    expect(_internal.parsePort("[::1]:8080")).toBe(8080);
    expect(_internal.parsePort("nope")).toBeNull();
  });

  test("parsePs reads pid and command columns", () => {
    const out = "  123 /usr/bin/foo --arg\n  456 bash -i\n";
    expect(_internal.parsePs(out)).toEqual([
      { pid: 123, command: "/usr/bin/foo --arg" },
      { pid: 456, command: "bash -i" },
    ]);
  });
});
