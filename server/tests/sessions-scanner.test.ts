import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { scanClaudeProjects } from "../src/sessions/scanner";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-scanner-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeFixture(path: string, lines: string[], mtime: Date) {
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
  utimesSync(path, mtime, mtime);
}

function line(sid: string, cwd: string, uuid = "u1") {
  return JSON.stringify({
    type: "user", uuid, timestamp: "2026-05-09T00:00:00Z",
    message: { role: "user", content: "hi" }, sessionId: sid, cwd,
  });
}

describe("scanClaudeProjects", () => {
  test("ingests sessions and skips files whose mtime is older than vault", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const cfg = join(tmp, ".claude");
    const sid = "sid-scan-1";
    writeFixture(join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`), [line(sid, "/tmp/proj")], new Date(1_000_000_000_000));
    db.query("INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("p1", "/tmp/proj", "proj", Date.now(), Date.now());
    const projects = [{ id: "p1", path: "/tmp/proj" }];
    const configDirs = [{ path: cfg, profile: "default" }];

    let scanned = await scanClaudeProjects({ db, vault: v, configDirs, projects });
    expect(scanned.filesProcessed).toBe(1);
    scanned = await scanClaudeProjects({ db, vault: v, configDirs, projects });
    expect(scanned.filesProcessed).toBe(0);
  });

  test("maps cwd to project_id by longest-prefix match including worktrees", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const cfg = join(tmp, ".claude");
    const sid = "sid-wt";
    writeFixture(join(cfg, "projects", "-proj--worktrees-feat", `${sid}.jsonl`), [line(sid, "/proj/.worktrees/feat")], new Date(1_000_000_000_000));
    db.query("INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("p1", "/proj", "proj", Date.now(), Date.now());
    await scanClaudeProjects({ db, vault: v, configDirs: [{ path: cfg, profile: "default" }], projects: [{ id: "p1", path: "/proj" }] });
    const row = db.query<{ project_id: string; worktree_label: string }, [string]>(
      "SELECT project_id, worktree_label FROM agent_sessions WHERE session_id = ?").get(sid);
    expect(row?.project_id).toBe("p1");
    expect(row?.worktree_label).toBe("feat");
  });

  test("tags each session with the profile of the config dir it came from", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const work = join(tmp, ".claude-work");
    const personal = join(tmp, ".claude-personal");
    writeFixture(join(work, "projects", "-w", "sid-w.jsonl"), [line("sid-w", "/w")], new Date(1_000_000_000_000));
    writeFixture(join(personal, "projects", "-p", "sid-p.jsonl"), [line("sid-p", "/p")], new Date(1_000_000_000_000));
    const configDirs = [{ path: work, profile: "work" }, { path: personal, profile: "personal" }];

    await scanClaudeProjects({ db, vault: v, configDirs, projects: [] });
    expect(v.getSession("sid-w")?.profile).toBe("work");
    expect(v.getSession("sid-p")?.profile).toBe("personal");

    // onlySessionIds narrowing finds a sid living in the second dir (no error; already ingested → 0 processed)
    const r = await scanClaudeProjects({ db, vault: v, configDirs, projects: [], onlySessionIds: new Set(["sid-p"]) });
    expect(r.filesProcessed).toBe(0);
  });
});

function aiTitleLine(sid: string, title: string) {
  return JSON.stringify({ type: "ai-title", aiTitle: title, sessionId: sid });
}

describe("scanClaudeProjects: ai-title ingestion", () => {
  test("ingesting a transcript with an ai-title line stores it on the session row", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const cfg = join(tmp, ".claude");
    const sid = "sid-title-1";
    writeFixture(
      join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`),
      [line(sid, "/tmp/proj"), aiTitleLine(sid, "Fix the parser")],
      new Date(1_000_000_000_000),
    );
    const configDirs = [{ path: cfg, profile: "default" }];

    await scanClaudeProjects({ db, vault: v, configDirs, projects: [] });
    expect(v.getSession(sid)?.title).toBe("Fix the parser");
  });

  test("when several ai-title lines are present, the last one wins", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const cfg = join(tmp, ".claude");
    const sid = "sid-title-2";
    writeFixture(
      join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`),
      [
        line(sid, "/tmp/proj"),
        aiTitleLine(sid, "Draft title"),
        aiTitleLine(sid, "Better title"),
        aiTitleLine(sid, "Final title"),
      ],
      new Date(1_000_000_000_000),
    );
    const configDirs = [{ path: cfg, profile: "default" }];

    await scanClaudeProjects({ db, vault: v, configDirs, projects: [] });
    expect(v.getSession(sid)?.title).toBe("Final title");
  });

  test("an ai-title line whose sessionId doesn't match the file's session is ignored", async () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const cfg = join(tmp, ".claude");
    const sid = "sid-title-3";
    writeFixture(
      join(cfg, "projects", "-tmp-proj", `${sid}.jsonl`),
      [line(sid, "/tmp/proj"), aiTitleLine("some-other-session", "Wrong session's title")],
      new Date(1_000_000_000_000),
    );
    const configDirs = [{ path: cfg, profile: "default" }];

    await scanClaudeProjects({ db, vault: v, configDirs, projects: [] });
    expect(v.getSession(sid)?.title).toBeNull();
  });
});
