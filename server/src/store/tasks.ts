import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type TaskStatus = "draft" | "running" | "review" | "done" | "abandoned";
export type TaskResult = "merged" | "pr" | "detached" | "discarded";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  intent: string;
  status: TaskStatus;
  baseBranch: string;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
  result: TaskResult | null;
  resultRef: string | null;
  createdAt: number;
  updatedAt: number;
  launchedAt: number | null;
};

type Row = {
  id: string;
  project_id: string;
  title: string;
  intent: string;
  status: string;
  base_branch: string;
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  pty_session_id: string | null;
  result: string | null;
  result_ref: string | null;
  created_at: number;
  updated_at: number;
  launched_at: number | null;
};

const fromRow = (r: Row): Task => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  intent: r.intent,
  status: r.status as TaskStatus,
  baseBranch: r.base_branch,
  branch: r.branch,
  worktreePath: r.worktree_path,
  sessionId: r.session_id,
  ptySessionId: r.pty_session_id,
  result: r.result as TaskResult | null,
  resultRef: r.result_ref,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  launchedAt: r.launched_at,
});

/** Human label for a Task — the trimmed first line of the intent, capped at 72 chars. */
export function taskTitle(intent: string): string {
  return intent.trim().split("\n")[0]!.trim().slice(0, 72);
}

/** URL/branch-safe slug: lowercase, non-alphanumeric runs become single dashes,
 *  trimmed of leading/trailing dashes, capped to the first ~5 words / 32 chars. */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Cap to first 5 words
  const fiveWords = base.split("-").slice(0, 5).join("-");
  if (fiveWords.length <= 32) return fiveWords;
  const cut = fiveWords.slice(0, 32);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

export function createTask(
  db: Database,
  input: { projectId: string; intent: string; baseBranch: string },
): Task {
  const id = randomUUID();
  const now = Date.now();
  const title = taskTitle(input.intent);
  db.query(
    `INSERT INTO tasks (id, project_id, title, intent, status, base_branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(id, input.projectId, title, input.intent, input.baseBranch, now, now);
  return getTaskById(db, id)!;
}

export function getTaskById(db: Database, id: string): Task | undefined {
  const row = db.query<Row, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? fromRow(row) : undefined;
}

export function listTasksByProject(db: Database, projectId: string): Task[] {
  return db
    .query<Row, [string]>(
      "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(projectId)
    .map(fromRow);
}

/** Tasks whose live status should be reconciled against the agent session. */
export function listActiveTasks(db: Database): Task[] {
  return db
    .query<Row, []>("SELECT * FROM tasks WHERE status IN ('running', 'review')")
    .all()
    .map(fromRow);
}

export type TaskPatch = {
  status?: TaskStatus;
  branch?: string | null;
  worktreePath?: string | null;
  sessionId?: string | null;
  ptySessionId?: string | null;
  result?: TaskResult | null;
  resultRef?: string | null;
  launchedAt?: number | null;
};

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  status: "status",
  branch: "branch",
  worktreePath: "worktree_path",
  sessionId: "session_id",
  ptySessionId: "pty_session_id",
  result: "result",
  resultRef: "result_ref",
  launchedAt: "launched_at",
};

export function updateTask(db: Database, id: string, patch: TaskPatch): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const key of Object.keys(patch) as Array<keyof TaskPatch>) {
    if (patch[key] === undefined) continue;
    sets.push(`${PATCH_COLUMNS[key]} = ?`);
    args.push(patch[key]);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(Date.now());
  args.push(id);
  db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(args as never[]));
}

export function deleteTask(db: Database, id: string): void {
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
}

/** Live agent state, as reported by live.ts (`working` | `waiting` | `stale`). */
export type LiveState = "working" | "waiting" | "stale";

/**
 * Mirrors each active Task's live agent state onto its `status`:
 * `working` → `running`; `waiting`/`stale` → `review`. Tasks with no live
 * entry (lookup returns undefined) are left untouched.
 */
export function reconcileTasks(
  db: Database,
  liveStateFor: (sessionId: string) => LiveState | undefined,
): void {
  for (const task of listActiveTasks(db)) {
    if (!task.sessionId) continue;
    const live = liveStateFor(task.sessionId);
    if (!live) continue;
    const desired: TaskStatus = live === "working" ? "running" : "review";
    if (desired !== task.status) updateTask(db, task.id, { status: desired });
  }
}
