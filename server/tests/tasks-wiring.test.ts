import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { createTask, updateTask, getTaskById, reconcileTasks } from "../src/store/tasks";
import { LiveAgentSessions } from "../src/sessions/live";

/**
 * Guards the index.ts wiring contract: reconcileTasks must accept a
 * live-state lookup backed by LiveAgentSessions.getEntry(...).state.
 */
describe("reconcileTasks ⇄ LiveAgentSessions", () => {
  test("a live 'working' entry keeps the task running", () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    updateTask(db, t.id, { status: "review", sessionId: "sid-1" });

    const live = new LiveAgentSessions();
    live.noteHeadlessRunStarted({
      agentSessionId: "sid-1", projectId: pid, projectName: "p",
      cwd: "/tmp/p", worktreeLabel: null, branch: null, prompt: "x",
    });

    reconcileTasks(db, (sid) => live.getEntry(sid)?.state);
    expect(getTaskById(db, t.id)!.status).toBe("running");
  });
});
