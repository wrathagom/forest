import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import {
  upsertProject,
  updateProject,
  getProjectById,
  relocateProject,
  ProjectPathConflictError,
  hashPath,
} from "../src/store/projects";
import { upsertSnapshot } from "../src/store/snapshots";
import { createTask } from "../src/store/tasks";
import { emptySnapshot } from "../src/scanner/types";

function seedProject(db: ReturnType<typeof openDb>, path: string) {
  const id = upsertProject(db, { path, name: "sirdar", group: "Personal" });
  updateProject(db, id, { pinned: true, lifecycleEnabled: true });
  upsertSnapshot(db, id, emptySnapshot());
  db.query(
    `INSERT INTO agent_sessions
       (session_id, agent, project_id, cwd, cwd_exists, last_activity, imported_at, source)
     VALUES (?, 'claude', ?, ?, 1, ?, ?, 'test')`,
  ).run("sess-1", id, path, Date.now(), Date.now());
  createTask(db, { projectId: id, intent: "do a thing", baseBranch: "main" });
  return id;
}

describe("relocateProject", () => {
  test("re-keys id + path and repoints snapshot, session, and task", () => {
    const db = openDb(":memory:");
    const oldId = seedProject(db, "/repos/Sirdar");

    const newId = relocateProject(db, oldId, "/repos/sirdar");

    expect(newId).toBe(hashPath("/repos/sirdar"));
    expect(newId).not.toBe(oldId);
    expect(getProjectById(db, oldId)).toBeUndefined();

    const moved = getProjectById(db, newId)!;
    expect(moved.path).toBe("/repos/sirdar");

    const count = (sql: string) =>
      (db.query<{ n: number }, [string]>(sql).get(newId) as { n: number }).n;
    expect(count("SELECT count(*) n FROM snapshots WHERE project_id = ?")).toBe(1);
    expect(count("SELECT count(*) n FROM agent_sessions WHERE project_id = ?")).toBe(1);
    expect(count("SELECT count(*) n FROM tasks WHERE project_id = ?")).toBe(1);
  });

  test("preserves pinned, group, and lifecycleEnabled; keeps created_at", () => {
    const db = openDb(":memory:");
    const oldId = seedProject(db, "/repos/Sirdar");
    updateProject(db, oldId, { hidden: true });
    const before = getProjectById(db, oldId)!;

    const newId = relocateProject(db, oldId, "/repos/sirdar");

    const after = getProjectById(db, newId)!;
    expect(after.pinned).toBe(true);
    expect(after.group).toBe("Personal");
    expect(after.lifecycleEnabled).toBe(true);
    expect(after.hidden).toBe(true);
    expect(after.createdAt).toBe(before.createdAt);
  });

  test("is a no-op when the path hash is unchanged", () => {
    const db = openDb(":memory:");
    const id = seedProject(db, "/repos/Sirdar");
    expect(relocateProject(db, id, "/repos/Sirdar")).toBe(id);
    expect(getProjectById(db, id)).toBeDefined();
  });

  test("throws ProjectPathConflictError when target path is taken", () => {
    const db = openDb(":memory:");
    const oldId = seedProject(db, "/repos/Sirdar");
    upsertProject(db, { path: "/repos/sirdar", name: "other" });

    expect(() => relocateProject(db, oldId, "/repos/sirdar")).toThrow(
      ProjectPathConflictError,
    );
    // original untouched
    expect(getProjectById(db, oldId)).toBeDefined();
  });

  test("leaves no dangling references to the old id", () => {
    const db = openDb(":memory:");
    const oldId = seedProject(db, "/repos/Sirdar");
    relocateProject(db, oldId, "/repos/sirdar");

    const dangling = (table: string) =>
      (db
        .query<{ n: number }, [string]>(`SELECT count(*) n FROM ${table} WHERE project_id = ?`)
        .get(oldId) as { n: number }).n;
    expect(dangling("snapshots")).toBe(0);
    expect(dangling("agent_sessions")).toBe(0);
    expect(dangling("tasks")).toBe(0);
  });
});
