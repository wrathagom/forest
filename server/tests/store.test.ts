import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db";
import {
  upsertProject,
  getProjectById,
  getProjectByPath,
  listVisibleProjects,
  updateProject,
  hashPath,
} from "../src/store/projects";

describe("openDb", () => {
  test("creates required tables on a fresh database", () => {
    const db = openDb(":memory:");
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain("projects");
    expect(tables).toContain("snapshots");
    expect(tables).toContain("config");
  });

  test("re-opening an existing database file preserves data", () => {
    const file = join(mkdtempSync(join(tmpdir(), "forest-db-")), "forest.db");
    const db1 = openDb(file);
    db1.exec("INSERT INTO config (key, value) VALUES ('marker', '1')");
    db1.close();

    const db2 = openDb(file);
    const row = db2
      .query<{ value: string }, []>("SELECT value FROM config WHERE key='marker'")
      .get();
    expect(row?.value).toBe("1");
    db2.close();
  });

  test("returns a Database instance", () => {
    const db = openDb(":memory:");
    expect(db).toBeInstanceOf(Database);
  });
});

describe("projects", () => {
  test("hashPath produces a stable hex id", () => {
    expect(hashPath("/a/b")).toBe(hashPath("/a/b"));
    expect(hashPath("/a/b")).not.toBe(hashPath("/a/c"));
    expect(hashPath("/a/b")).toMatch(/^[a-f0-9]{16}$/);
  });

  test("upsertProject inserts then updates name on second call", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/x/repo", name: "repo" });
    expect(getProjectById(db, id)?.name).toBe("repo");
    upsertProject(db, { path: "/x/repo", name: "repo-renamed" });
    expect(getProjectById(db, id)?.name).toBe("repo-renamed");
  });

  test("getProjectByPath returns the row or undefined", () => {
    const db = openDb(":memory:");
    upsertProject(db, { path: "/x/repo", name: "repo" });
    expect(getProjectByPath(db, "/x/repo")?.path).toBe("/x/repo");
    expect(getProjectByPath(db, "/missing")).toBeUndefined();
  });

  test("listVisibleProjects excludes hidden, sorts pinned-first then by name", () => {
    const db = openDb(":memory:");
    upsertProject(db, { path: "/a", name: "alpha" });
    upsertProject(db, { path: "/b", name: "beta" });
    upsertProject(db, { path: "/c", name: "charlie" });
    updateProject(db, hashPath("/b"), { pinned: true });
    updateProject(db, hashPath("/c"), { hidden: true });
    const rows = listVisibleProjects(db).map((r) => r.name);
    expect(rows).toEqual(["beta", "alpha"]);
  });

  test("updateProject patches only provided fields", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/x", name: "x" });
    updateProject(db, id, { pinned: true });
    expect(getProjectById(db, id)?.pinned).toBe(true);
    updateProject(db, id, { name: "renamed" });
    const row = getProjectById(db, id)!;
    expect(row.name).toBe("renamed");
    expect(row.pinned).toBe(true);
  });

  test("upsertProject sets group on insert", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/x/repo", name: "repo", group: "Personal" });
    expect(getProjectById(db, id)?.group).toBe("Personal");
  });

  test("upsertProject preserves a previously-set group on conflict", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/x/repo", name: "repo", group: "Personal" });
    upsertProject(db, { path: "/x/repo", name: "repo", group: "Other" });
    expect(getProjectById(db, id)?.group).toBe("Personal");
  });

  test("upsertProject backfills group on conflict if currently null", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/x/repo", name: "repo" });
    expect(getProjectById(db, id)?.group).toBeNull();
    upsertProject(db, { path: "/x/repo", name: "repo", group: "Personal" });
    expect(getProjectById(db, id)?.group).toBe("Personal");
  });
});

import { upsertSnapshot, getSnapshotByProjectId, listLatestSnapshots } from "../src/store/snapshots";
import type { Snapshot } from "../src/scanner/types";

const blank: Snapshot = {
  git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
  lastEdit: null,
  services: { docker: [], processes: [] },
  errors: [],
};

describe("snapshots", () => {
  test("upsertSnapshot inserts and overwrites by project_id", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/p", name: "p" });
    upsertSnapshot(db, id, blank);
    const first = getSnapshotByProjectId(db, id)!;
    expect(first.snapshot.git.dirty).toBe(false);

    const dirty: Snapshot = { ...blank, git: { ...blank.git, dirty: true, changed: 3 } };
    upsertSnapshot(db, id, dirty);
    const second = getSnapshotByProjectId(db, id)!;
    expect(second.snapshot.git.dirty).toBe(true);
    expect(second.snapshot.git.changed).toBe(3);
  });

  test("listLatestSnapshots returns one entry per project", () => {
    const db = openDb(":memory:");
    const a = upsertProject(db, { path: "/a", name: "a" });
    const b = upsertProject(db, { path: "/b", name: "b" });
    upsertSnapshot(db, a, blank);
    upsertSnapshot(db, b, blank);
    expect(listLatestSnapshots(db)).toHaveLength(2);
  });

  test("deleting a project cascades to its snapshot", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/p", name: "p" });
    upsertSnapshot(db, id, blank);
    db.query("DELETE FROM projects WHERE id = ?").run(id);
    expect(getSnapshotByProjectId(db, id)).toBeUndefined();
  });
});

import {
  getConfig,
  setConfig,
  getScanRoot,
  setScanRoot,
  getPollIntervalMs,
  setPollIntervalMs,
  DEFAULT_POLL_INTERVAL_MS,
  getBbsConfig,
  setBbsConfig,
  maskKey,
} from "../src/store/config";

describe("config", () => {
  test("get/set raw key/value", () => {
    const db = openDb(":memory:");
    expect(getConfig(db, "x")).toBeUndefined();
    setConfig(db, "x", "1");
    expect(getConfig(db, "x")).toBe("1");
    setConfig(db, "x", "2");
    expect(getConfig(db, "x")).toBe("2");
  });

  test("scan_root round-trip", () => {
    const db = openDb(":memory:");
    expect(getScanRoot(db)).toBeUndefined();
    setScanRoot(db, "/Users/me/Projects");
    expect(getScanRoot(db)).toBe("/Users/me/Projects");
  });

  test("poll_interval_ms returns default when unset, parses int when set", () => {
    const db = openDb(":memory:");
    expect(getPollIntervalMs(db)).toBe(DEFAULT_POLL_INTERVAL_MS);
    setPollIntervalMs(db, 5000);
    expect(getPollIntervalMs(db)).toBe(5000);
  });
});

import {
  getSessionMaxTotal,
  setSessionMaxTotal,
  getSessionMaxScrollbackLines,
  setSessionMaxScrollbackLines,
  getSessionDefaultShell,
  setSessionDefaultShell,
  DEFAULT_SESSION_MAX_TOTAL,
  DEFAULT_SESSION_MAX_SCROLLBACK_LINES,
} from "../src/store/config";

describe("session config keys", () => {
  test("session_max_total defaults and round-trips", () => {
    const db = openDb(":memory:");
    expect(getSessionMaxTotal(db)).toBe(DEFAULT_SESSION_MAX_TOTAL);
    setSessionMaxTotal(db, 8);
    expect(getSessionMaxTotal(db)).toBe(8);
  });

  test("session_max_scrollback_lines defaults and round-trips", () => {
    const db = openDb(":memory:");
    expect(getSessionMaxScrollbackLines(db)).toBe(DEFAULT_SESSION_MAX_SCROLLBACK_LINES);
    setSessionMaxScrollbackLines(db, 5000);
    expect(getSessionMaxScrollbackLines(db)).toBe(5000);
  });

  test("session_default_shell falls back to env or /bin/bash and round-trips", () => {
    const db = openDb(":memory:");
    const fallback = getSessionDefaultShell(db);
    expect(typeof fallback).toBe("string");
    expect(fallback.length).toBeGreaterThan(0);
    setSessionDefaultShell(db, "/bin/zsh");
    expect(getSessionDefaultShell(db)).toBe("/bin/zsh");
  });
});

import { getProjectSubdirs, setProjectSubdirs } from "../src/store/config";

describe("project_subdirs config key", () => {
  test("getProjectSubdirs returns [] when unset", () => {
    const db = openDb(":memory:");
    expect(getProjectSubdirs(db)).toEqual([]);
  });

  test("set/get round-trips a list", () => {
    const db = openDb(":memory:");
    setProjectSubdirs(db, ["Personal", "Professional"]);
    expect(getProjectSubdirs(db)).toEqual(["Personal", "Professional"]);
  });

  test("set deduplicates and trims and drops invalid entries", () => {
    const db = openDb(":memory:");
    setProjectSubdirs(db, [" Personal ", "Personal", "", "bad name", "Work_2"]);
    expect(getProjectSubdirs(db)).toEqual(["Personal", "Work_2"]);
  });

  test("set accepts slash-separated multi-segment paths", () => {
    const db = openDb(":memory:");
    setProjectSubdirs(db, ["Professional", "Professional/Customers", "A/B/C"]);
    expect(getProjectSubdirs(db)).toEqual(["Professional", "Professional/Customers", "A/B/C"]);
  });

  test("set rejects path-traversal and empty-segment forms", () => {
    const db = openDb(":memory:");
    setProjectSubdirs(db, ["..", "../escape", "Personal/..", "/leading", "trailing/", "double//slash"]);
    expect(getProjectSubdirs(db)).toEqual([]);
  });

  test("get returns [] when the stored value is malformed JSON", () => {
    const db = openDb(":memory:");
    db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('project_subdirs', '{not json')");
    expect(getProjectSubdirs(db)).toEqual([]);
  });

  test("get returns [] when the stored value is not an array", () => {
    const db = openDb(":memory:");
    db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('project_subdirs', '\"x\"')");
    expect(getProjectSubdirs(db)).toEqual([]);
  });
});

describe("agent_sessions profile column", () => {
  test("a fresh DB has a profile column", () => {
    const db = openDb(":memory:");
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(agent_sessions)").all().map((c) => c.name);
    expect(cols).toContain("profile");
  });

  test("openDb's migration is idempotent (no duplicate profile column)", () => {
    const db = openDb(":memory:");
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(agent_sessions)").all().map((c) => c.name);
    expect(cols.filter((c) => c === "profile")).toHaveLength(1);
  });
});

describe("openDb agent-sessions schema", () => {
  test("creates the five new tables and the FTS virtual table", () => {
    const db = openDb(":memory:");
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(names).toContain("agent_sessions");
    expect(names).toContain("agent_messages");
    expect(names).toContain("agent_messages_fts");
    expect(names).toContain("agent_tool_calls");
    expect(names).toContain("agent_session_events");
  });

  test("inserting and reading an agent_session round-trips", () => {
    const db = openDb(":memory:");
    db.query(
      `INSERT INTO agent_sessions
         (session_id, agent, cwd, last_activity, imported_at, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("sid-1", "claude", "/tmp/proj", 1, 1, "scan");
    const row = db
      .query<{ session_id: string; agent: string }, [string]>(
        "SELECT session_id, agent FROM agent_sessions WHERE session_id = ?",
      )
      .get("sid-1");
    expect(row?.agent).toBe("claude");
  });
});

describe("bbs config", () => {
  test("defaults when unset", () => {
    const db = openDb(":memory:");
    const c = getBbsConfig(db);
    expect(c.enabled).toBe(false);
    expect(c.accountKey).toBeNull();
    expect(c.baseUrl).toBe("https://app.bigbeautifulscreens.com");
    expect(c.alertLingerSec).toBe(60);
    expect(c.hudIntervalMs).toBe(30000);
    expect(c.rotationIntervalSec).toBe(8);
    expect(c.hudPanelCap).toBe(6);
    expect(c.alertEvents).toEqual(["waiting", "stop"]);
  });

  test("round-trips set values and clamps numbers", () => {
    const db = openDb(":memory:");
    setBbsConfig(db, { enabled: true, accountKey: "ak_abc", screenId: "s1", screenKey: "sk_x", alertLingerSec: 1, hudPanelCap: 0, alertEvents: ["waiting"] });
    const c = getBbsConfig(db);
    expect(c.enabled).toBe(true);
    expect(c.accountKey).toBe("ak_abc");
    expect(c.screenId).toBe("s1");
    expect(c.screenKey).toBe("sk_x");
    expect(c.alertLingerSec).toBe(5); // clamped to min 5
    expect(c.hudPanelCap).toBe(1);    // clamped to min 1
    expect(c.alertEvents).toEqual(["waiting"]);
  });

  test("maskKey shows only last 4", () => {
    expect(maskKey(null)).toBeNull();
    expect(maskKey("ak_12345678")).toBe("••••5678");
    expect(maskKey("abc")).toBe("••••");
  });
});
