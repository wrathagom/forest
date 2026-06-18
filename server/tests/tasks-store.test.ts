import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import {
  createTask, getTaskById, listTasksByProject, listActiveTasks,
  taskTitle, slugify,
} from "../src/store/tasks";

function seedProject(db: ReturnType<typeof openDb>, id = "p1") {
  db.query(
    "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, `/tmp/${id}`, id, 1, 1);
  return id;
}

describe("taskTitle / slugify", () => {
  test("taskTitle takes the trimmed first line, capped", () => {
    expect(taskTitle("  Add rate limiting\nmore detail  ")).toBe("Add rate limiting");
    expect(taskTitle("x".repeat(200)).length).toBe(72);
  });
  test("slugify lowercases and dashes non-alphanumerics", () => {
    expect(slugify("Add rate limiting to the API!")).toBe("add-rate-limiting-to-the");
    expect(slugify("  --weird__name--  ")).toBe("weird-name");
  });
});

describe("createTask / getTaskById", () => {
  test("creates a draft task and reads it back", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const task = createTask(db, {
      projectId: pid, intent: "Add rate limiting\nbe careful", baseBranch: "main",
    });
    expect(task.status).toBe("draft");
    expect(task.title).toBe("Add rate limiting");
    expect(task.baseBranch).toBe("main");
    expect(task.branch).toBeNull();
    expect(task.worktreePath).toBeNull();
    const read = getTaskById(db, task.id);
    expect(read).toEqual(task);
  });
  test("getTaskById returns undefined for an unknown id", () => {
    const db = openDb(":memory:");
    expect(getTaskById(db, "nope")).toBeUndefined();
  });
});

describe("listTasksByProject / listActiveTasks", () => {
  test("lists a project's tasks newest-first", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const a = createTask(db, { projectId: pid, intent: "first", baseBranch: "main" });
    const b = createTask(db, { projectId: pid, intent: "second", baseBranch: "main" });
    const ids = listTasksByProject(db, pid).map((t) => t.id);
    expect(ids).toEqual([b.id, a.id]);
  });
  test("listActiveTasks returns only running/review tasks", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const running = createTask(db, { projectId: pid, intent: "r", baseBranch: "main" });
    db.query("UPDATE tasks SET status = 'running' WHERE id = ?").run(running.id);
    const review = createTask(db, { projectId: pid, intent: "v", baseBranch: "main" });
    db.query("UPDATE tasks SET status = 'review' WHERE id = ?").run(review.id);
    createTask(db, { projectId: pid, intent: "still a draft", baseBranch: "main" });
    const done = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    db.query("UPDATE tasks SET status = 'done' WHERE id = ?").run(done.id);
    expect(listActiveTasks(db).map((t) => t.id).sort()).toEqual([running.id, review.id].sort());
  });
});

import { updateTask, deleteTask, reconcileTasks } from "../src/store/tasks";

describe("updateTask / deleteTask", () => {
  test("updateTask patches only the given fields and bumps updated_at", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const task = createTask(db, { projectId: pid, intent: "go", baseBranch: "main" });
    updateTask(db, task.id, {
      status: "running", branch: "task/go", worktreePath: "/tmp/p1/.worktrees/go",
      sessionId: "sid-1", ptySessionId: "pty-1", launchedAt: 999,
    });
    const t = getTaskById(db, task.id)!;
    expect(t.status).toBe("running");
    expect(t.branch).toBe("task/go");
    expect(t.sessionId).toBe("sid-1");
    expect(t.ptySessionId).toBe("pty-1");
    expect(t.launchedAt).toBe(999);
    expect(t.updatedAt).toBeGreaterThanOrEqual(t.createdAt);
  });
  test("updateTask can clear worktreePath to null", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const task = createTask(db, { projectId: pid, intent: "go", baseBranch: "main" });
    updateTask(db, task.id, { worktreePath: "/tmp/x" });
    updateTask(db, task.id, { worktreePath: null });
    expect(getTaskById(db, task.id)!.worktreePath).toBeNull();
  });
  test("deleteTask removes the row", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const task = createTask(db, { projectId: pid, intent: "go", baseBranch: "main" });
    deleteTask(db, task.id);
    expect(getTaskById(db, task.id)).toBeUndefined();
  });
});

describe("reconcileTasks", () => {
  test("maps live state onto running/review tasks", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const a = createTask(db, { projectId: pid, intent: "a", baseBranch: "main" });
    const b = createTask(db, { projectId: pid, intent: "b", baseBranch: "main" });
    updateTask(db, a.id, { status: "running", sessionId: "sa" });
    updateTask(db, b.id, { status: "running", sessionId: "sb" });
    const live: Record<string, "working" | "waiting" | "stale"> = { sa: "waiting", sb: "working" };
    reconcileTasks(db, (sid) => live[sid]);
    expect(getTaskById(db, a.id)!.status).toBe("review");   // waiting → review
    expect(getTaskById(db, b.id)!.status).toBe("running");  // working → running
  });
  test("leaves a task unchanged when there is no live entry", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const a = createTask(db, { projectId: pid, intent: "a", baseBranch: "main" });
    updateTask(db, a.id, { status: "review", sessionId: "sa" });
    reconcileTasks(db, () => undefined);
    expect(getTaskById(db, a.id)!.status).toBe("review");
  });
  test("ignores done/abandoned tasks", () => {
    const db = openDb(":memory:");
    const pid = seedProject(db);
    const a = createTask(db, { projectId: pid, intent: "a", baseBranch: "main" });
    updateTask(db, a.id, { status: "done", sessionId: "sa" });
    reconcileTasks(db, () => "working");
    expect(getTaskById(db, a.id)!.status).toBe("done");
  });
});
