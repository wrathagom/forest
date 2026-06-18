import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { LiveAgentSessions } from "../src/sessions/live";
import { AgentRunner, type SpawnFn, type SpawnedProc } from "../src/sessions/runner";

class FakeProc implements SpawnedProc {
  pid = Math.floor(Math.random() * 100000);
  killed: string | null = null;
  private resolveExit!: (code: number) => void;
  exited = new Promise<number>((r) => { this.resolveExit = r; });
  kill(sig?: string) { this.killed = sig ?? "SIGTERM"; }
  finish(code = 0) { this.resolveExit(code); }
}

function fakeSpawn() {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const procs: FakeProc[] = [];
  const fn: SpawnFn = (opts) => { calls.push({ cmd: opts.cmd, cwd: opts.cwd }); const p = new FakeProc(); procs.push(p); return p; };
  return { fn, calls, procs };
}

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "forest-runner-"));
  const projPath = join(tmp, "proj");
  mkdirSync(projPath, { recursive: true });
  const db = openDb(":memory:");
  // Seed the projects table so FK constraint on agent_sessions.project_id is satisfied
  const now = Date.now();
  db.query("INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("p1", projPath, "Proj", now, now);
  const vault = new Vault(db);
  const live = new LiveAgentSessions();
  const spawn = fakeSpawn();
  let ptyWriter: ((d: string) => void) | null = null;
  const runner = new AgentRunner({
    vault, liveSessions: live,
    listProjects: () => [{ id: "p1", path: projPath }],
    projectName: () => "Proj",
    ptyWriterFor: () => ptyWriter,
    spawn: spawn.fn,
    claudeBin: "claude",
  });
  return { tmp, projPath, db, vault, live, spawn, runner, setPtyWriter: (f: ((d: string) => void) | null) => { ptyWriter = f; } };
}

describe("AgentRunner", () => {
  test("launch mints a session row, seeds the live registry, and spawns `claude -p` with --session-id + --permission-mode", async () => {
    const t = setup();
    try {
      const { sessionId } = await t.runner.launch({ projectId: "p1", prompt: "go fix CI", permissionMode: "acceptEdits" });
      const row = t.vault.getSession(sessionId)!;
      expect(row.launched_via).toBe("mobile");
      expect(row.permission_mode).toBe("acceptEdits");
      expect(row.project_id).toBe("p1");
      const e = t.live.getEntry(sessionId)!;
      expect(e.state).toBe("working");
      expect(e.lastUserMsg).toBe("go fix CI");
      expect(e.launchedVia).toBe("mobile");
      const cmd = t.spawn.calls[0]!.cmd;
      expect(cmd[0]).toBe("claude");
      expect(cmd).toContain("-p");
      expect(cmd).toContain("go fix CI");
      expect(cmd[cmd.indexOf("--session-id") + 1]).toBe(sessionId);
      expect(cmd[cmd.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
      expect(t.spawn.calls[0]!.cwd).toBe(t.projPath);
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("launch rejects an unknown project", async () => {
    const t = setup();
    try { await expect(t.runner.launch({ projectId: "nope", prompt: "x", permissionMode: "plan" })).rejects.toThrow(/unknown project/); }
    finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("launch rejects an empty prompt", async () => {
    const t = setup();
    try { await expect(t.runner.launch({ projectId: "p1", prompt: "   ", permissionMode: "plan" })).rejects.toThrow(/prompt/); }
    finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply writes `<text>\\r` to the live PTY when one is running it", async () => {
    const t = setup();
    try {
      const { sessionId } = await t.runner.launch({ projectId: "p1", prompt: "go", permissionMode: "plan" });
      const captured: string[] = [];
      t.setPtyWriter((d) => captured.push(d));
      await t.runner.reply({ sessionId, text: "yes do it" });
      expect(captured).toEqual(["yes do it\r"]);
      expect(t.spawn.calls.length).toBe(1); // no new spawn beyond the launch
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply spawns `claude -p <text> --resume <sid>` when no live PTY (vault-only session, no live entry)", async () => {
    const t = setup();
    try {
      // Seed a vault row directly — no launch, so no live entry → not in working state
      t.vault.upsertSession({
        session_id: "rs1", agent: "claude", cwd: t.projPath,
        last_activity: 1, project_id: "p1", source: "scan",
      });
      t.setPtyWriter(null);
      await t.runner.reply({ sessionId: "rs1", text: "continue" });
      expect(t.spawn.calls.length).toBe(1);
      const cmd = t.spawn.calls[0]!.cmd;
      expect(cmd[cmd.indexOf("--resume") + 1]).toBe("rs1");
      expect(cmd).toContain("continue");
      // re-seeded the live registry with the new turn
      expect(t.live.getEntry("rs1")!.lastUserMsg).toBe("continue");
      expect(t.live.getEntry("rs1")!.state).toBe("working");
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply rejects with 'busy' when the session has a live working entry and no PTY writer", async () => {
    const t = setup();
    try {
      const { sessionId } = await t.runner.launch({ projectId: "p1", prompt: "go", permissionMode: "acceptEdits" });
      // Session is now in 'working' state in the live registry
      expect(t.live.getEntry(sessionId)!.state).toBe("working");
      t.setPtyWriter(null);
      await expect(t.runner.reply({ sessionId, text: "continue" })).rejects.toThrow(/busy/);
      // No new spawn should have happened beyond the original launch
      expect(t.spawn.calls.length).toBe(1);
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply rejects an unknown session", async () => {
    const t = setup();
    try { await expect(t.runner.reply({ sessionId: "ghost", text: "hi" })).rejects.toThrow(/unknown session/); }
    finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply rejects empty text", async () => {
    const t = setup();
    try {
      const { sessionId } = await t.runner.launch({ projectId: "p1", prompt: "go", permissionMode: "plan" });
      await expect(t.runner.reply({ sessionId, text: "  " })).rejects.toThrow(/text/);
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("shutdown SIGTERMs live children", async () => {
    const t = setup();
    try {
      await t.runner.launch({ projectId: "p1", prompt: "a", permissionMode: "plan" });
      await t.runner.launch({ projectId: "p1", prompt: "b", permissionMode: "plan" });
      t.runner.shutdown();
      expect(t.spawn.procs.length).toBe(2);
      expect(t.spawn.procs.every((p) => p.killed === "SIGTERM")).toBe(true);
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("reply uses acceptEdits fallback when session has null permission_mode", async () => {
    const t = setup();
    try {
      // Insert a session row with null permission_mode directly (simulates a scan-sourced session)
      t.vault.upsertSession({
        session_id: "scan-sid", agent: "claude", cwd: t.projPath,
        last_activity: 1, project_id: "p1", source: "scan",
      });
      // No live PTY — force the --resume spawn path
      t.setPtyWriter(null);
      await t.runner.reply({ sessionId: "scan-sid", text: "continue from scan" });
      const cmd = t.spawn.calls[0]!.cmd;
      const pmIdx = cmd.indexOf("--permission-mode");
      expect(pmIdx).toBeGreaterThan(-1);
      expect(cmd[pmIdx + 1]).toBe("acceptEdits");
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });

  test("a child that exits is removed from the live-procs map (shutdown won't re-kill it)", async () => {
    const t = setup();
    try {
      await t.runner.launch({ projectId: "p1", prompt: "a", permissionMode: "plan" });
      const p = t.spawn.procs[0]!;
      p.finish(0);
      await p.exited;
      await new Promise((r) => setTimeout(r, 0));
      t.runner.shutdown();
      expect(p.killed).toBeNull();
    } finally { rmSync(t.tmp, { recursive: true, force: true }); }
  });
});
