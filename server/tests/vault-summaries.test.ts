import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { scanClaudeProjects } from "../src/sessions/scanner";

let db: Database;
let vault: Vault;

beforeEach(() => {
  db = openDb(":memory:");
  vault = new Vault(db);
});

function seedSession(sessionId: string, lastActivity = 1000): void {
  vault.upsertSession({
    session_id: sessionId,
    agent: "claude",
    cwd: "/proj",
    last_activity: lastActivity,
    source: "scan",
  });
}

describe("session title", () => {
  test("upsertSession stores a title", () => {
    seedSession("s1");
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", title: "Fix the parser",
    });
    expect(vault.getSession("s1")?.title).toBe("Fix the parser");
  });

  test("a later scan without a title does not erase the stored one", () => {
    seedSession("s1");
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", title: "Fix the parser",
    });
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 2000, source: "scan",
    });
    expect(vault.getSession("s1")?.title).toBe("Fix the parser");
  });
});

describe("scanner: ai-title ingestion", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-vault-title-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  function writeFixture(path: string, lines: string[], mtime: Date) {
    mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(path, lines.join("\n") + "\n");
    utimesSync(path, mtime, mtime);
  }

  function userLine(sid: string, cwd: string, uuid = "u1") {
    return JSON.stringify({
      type: "user", uuid, timestamp: "2026-05-09T00:00:00Z",
      message: { role: "user", content: "hi" }, sessionId: sid, cwd,
    });
  }

  function aiTitleLine(sid: string, title: string) {
    return JSON.stringify({ type: "ai-title", aiTitle: title, sessionId: sid });
  }

  test("ingesting a transcript with an ai-title line stores it on the session row", async () => {
    const cfg = join(tmp, ".claude");
    const sid = "sid-title-1";
    writeFixture(
      join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`),
      [userLine(sid, "/tmp/proj"), aiTitleLine(sid, "Fix the parser")],
      new Date(1_000_000_000_000),
    );
    const configDirs = [{ path: cfg, profile: "default" }];

    await scanClaudeProjects({ db, vault, configDirs, projects: [] });
    expect(vault.getSession(sid)?.title).toBe("Fix the parser");
  });

  test("when several ai-title lines are present, the last one wins", async () => {
    const cfg = join(tmp, ".claude");
    const sid = "sid-title-2";
    writeFixture(
      join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`),
      [
        userLine(sid, "/tmp/proj"),
        aiTitleLine(sid, "Draft title"),
        aiTitleLine(sid, "Better title"),
        aiTitleLine(sid, "Final title"),
      ],
      new Date(1_000_000_000_000),
    );
    const configDirs = [{ path: cfg, profile: "default" }];

    await scanClaudeProjects({ db, vault, configDirs, projects: [] });
    expect(vault.getSession(sid)?.title).toBe("Final title");
  });
});
