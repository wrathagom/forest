import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { resolveLaunchEnv } from "../src/sessions/claude-profile-resolver";
import type { ClaudeConfigDir } from "../src/sessions/config-dirs";

const personal: ClaudeConfigDir = { path: "/home/u/.claude-personal", profile: "personal" };
const work: ClaudeConfigDir = { path: "/home/u/.claude-work", profile: "work" };
const dflt: ClaudeConfigDir = { path: "/home/u/.claude", profile: "default" };

describe("resolveLaunchEnv — non-claude agents", () => {
  test("undefined agent → empty env", () => {
    const v = new Vault(openDb(":memory:"));
    expect(resolveLaunchEnv(
      { vault: v, configDirs: () => [personal, work, dflt], resolveByCwd: () => "personal" },
      { agent: undefined, cwd: "/p", args: [] },
    )).toEqual({});
  });

  test("agent='shell' → empty env, never calls resolveByCwd", () => {
    const v = new Vault(openDb(":memory:"));
    let called = false;
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal], resolveByCwd: () => { called = true; return "personal"; } },
      { agent: "shell", cwd: "/p", args: [] },
    );
    expect(env).toEqual({});
    expect(called).toBe(false);
  });
});

describe("resolveLaunchEnv — resume case", () => {
  test("vault profile + matching configDir → sets CLAUDE_CONFIG_DIR; does NOT call resolveByCwd", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "sid-1", agent: "claude", cwd: "/somewhere", last_activity: 1,
      source: "scan", profile: "personal",
    });
    let called = false;
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal, work, dflt], resolveByCwd: () => { called = true; return null; } },
      { agent: "claude", cwd: "/anywhere", args: ["--resume", "sid-1"] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: personal.path });
    expect(called).toBe(false);
  });

  test("--resume=<sid> (equals form) parsed the same", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "sid-2", agent: "claude", cwd: "/x", last_activity: 1,
      source: "scan", profile: "work",
    });
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal, work], resolveByCwd: () => null },
      { agent: "claude", cwd: "/x", args: ["--resume=sid-2"] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: work.path });
  });

  test("resume sid not in vault → falls through to cwd resolution", () => {
    const v = new Vault(openDb(":memory:"));
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal], resolveByCwd: () => "personal" },
      { agent: "claude", cwd: "/x", args: ["--resume", "missing-sid"] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: personal.path });
  });

  test("resume sid present but profile is null → falls through to cwd resolution", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "sid-old", agent: "claude", cwd: "/x", last_activity: 1, source: "scan",
    });
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal], resolveByCwd: () => "personal" },
      { agent: "claude", cwd: "/x", args: ["--resume", "sid-old"] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: personal.path });
  });
});

describe("resolveLaunchEnv — cwd case", () => {
  test("profile name from resolveByCwd + matching configDir → sets env", () => {
    const v = new Vault(openDb(":memory:"));
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal, work], resolveByCwd: () => "personal" },
      { agent: "claude", cwd: "/home/u/Projects/Personal/x", args: [] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: personal.path });
  });

  test("resolveByCwd returns null → empty env", () => {
    const v = new Vault(openDb(":memory:"));
    const env = resolveLaunchEnv(
      { vault: v, configDirs: () => [personal, work], resolveByCwd: () => null },
      { agent: "claude", cwd: "/somewhere/odd", args: [] },
    );
    expect(env).toEqual({});
  });

  test("profile resolves but no matching configDir → empty env + warn log", () => {
    const v = new Vault(openDb(":memory:"));
    const logs: Array<{ level: string; msg: string }> = [];
    const env = resolveLaunchEnv(
      {
        vault: v,
        configDirs: () => [personal], // no "work" dir
        resolveByCwd: () => "work",
        log: (level, msg) => logs.push({ level, msg }),
      },
      { agent: "claude", cwd: "/x", args: [] },
    );
    expect(env).toEqual({});
    expect(logs.some((l) => l.level === "warn" && l.msg.includes("work"))).toBe(true);
  });
});

describe("resolveLaunchEnv — default resolveByCwd (spawn path)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-resolver-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test("spawns the executable on PATH and uses its stdout", () => {
    const bin = join(tmp, "multi-agent-profiles");
    writeFileSync(bin, "#!/usr/bin/env bash\necho personal\n");
    chmodSync(bin, 0o755);
    const v = new Vault(openDb(":memory:"));
    const env = resolveLaunchEnv(
      {
        vault: v,
        configDirs: () => [personal],
        spawnEnv: { PATH: `${tmp}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "/tmp" },
      },
      { agent: "claude", cwd: "/anywhere", args: [] },
    );
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: personal.path });
  });

  test("missing executable → returns {} (no throw)", () => {
    const v = new Vault(openDb(":memory:"));
    const env = resolveLaunchEnv(
      {
        vault: v,
        configDirs: () => [personal],
        spawnEnv: { PATH: tmp, HOME: tmp },
      },
      { agent: "claude", cwd: "/anywhere", args: [] },
    );
    expect(env).toEqual({});
  });
});
