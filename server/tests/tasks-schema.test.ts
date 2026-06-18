import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";

describe("tasks table", () => {
  test("exists with the expected columns", () => {
    const db = openDb(":memory:");
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(tasks)")
      .all()
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual(
      [
        "base_branch", "branch", "created_at", "id", "intent", "launched_at",
        "project_id", "pty_session_id", "result", "result_ref", "session_id",
        "status", "title", "updated_at", "worktree_path",
      ].sort(),
    );
  });

  test("cascades delete from projects", () => {
    const db = openDb(":memory:");
    db.query(
      "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("p1", "/tmp/p1", "p1", 1, 1);
    db.query(
      `INSERT INTO tasks (id, project_id, title, intent, status, base_branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("t1", "p1", "t", "do a thing", "draft", "main", 1, 1);
    db.query("DELETE FROM projects WHERE id = ?").run("p1");
    expect(db.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});
