import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/sessions/registry";
import { makeFakePtyFactory } from "./helpers/fakePty";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkRegistry(opts?: { maxTotal?: number; maxScrollbackBytes?: number; defaultShell?: string }) {
  const { factory, instances } = makeFakePtyFactory();
  const reg = new SessionRegistry({
    pty: factory,
    maxTotal: opts?.maxTotal ?? 32,
    maxScrollbackBytes: opts?.maxScrollbackBytes ?? 200_000,
    defaultShell: opts?.defaultShell ?? "/bin/bash",
    coalesceMs: 1,
    exitRetentionMs: 50,
  });
  return { reg, instances };
}

describe("SessionRegistry", () => {
  test("create returns a session with defaults applied", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    expect(s.projectId).toBe("p1");
    expect(s.cwd).toBe("/a");
    expect(s.command).toBe("/bin/bash");
    expect(s.args).toEqual([]);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.spawn.cwd).toBe("/a");
  });

  test("custom command and args are honored", () => {
    const { reg, instances } = mkRegistry();
    reg.create({ projectId: "p1", cwd: "/a", command: "/bin/echo", args: ["hi"], cols: 80, rows: 24 });
    expect(instances[0]!.spawn.command).toBe("/bin/echo");
    expect(instances[0]!.spawn.args).toEqual(["hi"]);
  });

  test("scrollback accumulates pty output", async () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    instances[0]!.emitData("hello ");
    instances[0]!.emitData("world");
    await wait(20);
    expect(s.scrollback.toString()).toBe("hello world");
  });

  test("countByProject and listByProject reflect creates", () => {
    const { reg } = mkRegistry();
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    reg.create({ projectId: "p2", cwd: "/b", cols: 80, rows: 24 });
    expect(reg.countByProject("p1")).toBe(2);
    expect(reg.countByProject("p2")).toBe(1);
    expect(reg.listByProject("p1")).toHaveLength(2);
  });

  test("kill removes the session and signals the pty", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    reg.kill(s.id);
    expect(reg.get(s.id)).toBeUndefined();
    expect(instances[0]!.killed).toHaveLength(1);
  });

  test("killAllForProject kills only that project's sessions", () => {
    const { reg } = mkRegistry();
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const keep = reg.create({ projectId: "p2", cwd: "/b", cols: 80, rows: 24 });
    reg.killAllForProject("p1");
    expect(reg.countByProject("p1")).toBe(0);
    expect(reg.get(keep.id)).toBeDefined();
  });

  test("at-cap create throws", () => {
    const { reg } = mkRegistry({ maxTotal: 1 });
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    expect(() => reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 })).toThrow(/limit/i);
  });

  test("pty exit retains the session for the retention window then drops it", async () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    instances[0]!.emitExit(0);
    expect(reg.get(s.id)).toBeDefined();
    await wait(80);
    expect(reg.get(s.id)).toBeUndefined();
  });

  test("create stores launcher binding when provided", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({
      projectId: "p1", cwd: "/a", cols: 80, rows: 24,
      launcher: { id: "claude", agent: "claude" },
    });
    expect(s.launcher?.agent).toBe("claude");
    expect(instances).toHaveLength(1);
  });

  test("create injects FOREST_PTY into the pty env matching the session id", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    expect(instances[0]!.spawn.env.FOREST_PTY).toBe(s.id);
  });

  test("pty exit notifies liveSessions.markEndedByPty with the session id", () => {
    const { factory, instances } = makeFakePtyFactory();
    const ended: string[] = [];
    const reg = new SessionRegistry({
      pty: factory,
      maxTotal: 8,
      maxScrollbackBytes: 1000,
      defaultShell: "/bin/bash",
      coalesceMs: 1,
      exitRetentionMs: 50,
      liveSessions: { markEndedByPty: (id) => ended.push(id) },
    });
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    instances[0]!.emitExit(0);
    expect(ended).toEqual([s.id]);
  });

  test("resolveLaunchEnv injects extra env keys into the spawn", () => {
    const { factory, instances } = makeFakePtyFactory();
    const reg = new SessionRegistry({
      pty: factory,
      maxTotal: 32,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 1,
      exitRetentionMs: 50,
      resolveLaunchEnv: (input) => {
        expect(input.cwd).toBe("/a");
        expect(input.launcher?.agent).toBe("claude");
        return { CLAUDE_CONFIG_DIR: "/x" };
      },
    });
    reg.create({
      projectId: "p1", cwd: "/a", command: "claude", args: ["--resume", "sid"],
      cols: 80, rows: 24, launcher: { id: "claude", agent: "claude" },
    });
    const env = instances[0]!.spawn.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBe("/x");
    expect(env.FOREST_PTY).toBeDefined();
  });

  test("no resolveLaunchEnv dep → behavior unchanged (no CLAUDE_CONFIG_DIR injected)", () => {
    const { reg, instances } = mkRegistry();
    reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const env = instances[0]!.spawn.env as Record<string, string>;
    expect(env.FOREST_PTY).toBeDefined();
    // CLAUDE_CONFIG_DIR may or may not be present depending on host env; just assert
    // that no injection happened by checking it equals whatever process.env has.
    expect(env.CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR as string | undefined as any);
  });
});
