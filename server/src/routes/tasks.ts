import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import type { Project } from "../store/projects";
import { getProjectById } from "../store/projects";
import {
  createTask, getTaskById, listTasksByProject, updateTask, deleteTask, slugify,
  type Task,
} from "../store/tasks";
import {
  defaultRunGit, gitRangeDiff, gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch,
  gitMerge, gitPush, gitCurrentBranch, gitBranchExists, type RunGit,
} from "../git";
import { defaultRunGh, ghCreatePr, type RunGh } from "../gh";

/** The slice of SessionRegistry the task routes need. SessionRegistry satisfies it. */
export type TaskSessionHost = {
  create(input: {
    projectId: string; cwd: string; command: string; args: string[];
    cols: number; rows: number; launcher?: { id: string; agent?: string };
  }): { id: string };
  kill(id: string): void;
};

export type TaskRoutesDeps = {
  sessions: TaskSessionHost;
  runGit?: RunGit;
  runGh?: RunGh;
};

/** Picks a worktree/branch slug for a Task with no on-disk worktree AND no
 *  existing `task/<slug>` branch. */
async function freeSlug(projectPath: string, base: string, runGit: RunGit): Promise<string> {
  const root = base || "task";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    const dirFree = !existsSync(join(projectPath, ".worktrees", slug));
    const branchFree = !(await gitBranchExists(projectPath, `task/${slug}`, runGit));
    if (dirFree && branchFree) return slug;
  }
}

/**
 * Launches a draft Task: creates the worktree, spawns the claude PTY, and
 * records the launch fields. Returns the updated Task, or an Error to surface.
 * On a worktree-add failure the Task is left untouched (still a draft).
 */
async function launchTask(
  ctx: { db: import("bun:sqlite").Database },
  deps: TaskRoutesDeps,
  runGit: RunGit,
  project: Project,
  task: Task,
): Promise<Task | Error> {
  const slug = await freeSlug(project.path, slugify(task.title), runGit);
  const branch = `task/${slug}`;
  const dest = join(project.path, ".worktrees", slug);

  try {
    await gitWorktreeAdd(project.path, dest, branch, task.baseBranch, runGit);
  } catch (err) {
    return err as Error;
  }

  const sessionId = randomUUID();
  let pty: { id: string };
  try {
    pty = deps.sessions.create({
      projectId: project.id,
      cwd: dest,
      command: "claude",
      args: ["--session-id", sessionId, "--permission-mode", "bypassPermissions", task.intent],
      cols: 120,
      rows: 32,
      launcher: { id: "task", agent: "claude" },
    });
  } catch (err) {
    // Spawn failed — roll the worktree back so we don't leak it.
    await gitWorktreeRemove(project.path, dest, runGit).catch(() => {});
    await gitDeleteBranch(project.path, branch, runGit).catch(() => {});
    return err as Error;
  }

  updateTask(ctx.db, task.id, {
    status: "running",
    branch,
    worktreePath: dest,
    sessionId,
    ptySessionId: pty.id,
    launchedAt: Date.now(),
  });
  return getTaskById(ctx.db, task.id)!;
}

type CompletionAction = "merged" | "pr" | "detached" | "discarded";

const COMPLETIONS: Record<string, { result: CompletionAction } | undefined> = {
  "done:merged": { result: "merged" },
  "done:pr": { result: "pr" },
  "done:detached": { result: "detached" },
  "abandoned:discarded": { result: "discarded" },
};

/**
 * Completes a launched Task. Returns the updated Task, or an object describing
 * an HTTP error the handler should surface.
 */
async function completeTask(
  ctx: { db: import("bun:sqlite").Database },
  deps: TaskRoutesDeps,
  runGit: RunGit,
  runGh: RunGh,
  project: Project,
  task: Task,
  action: CompletionAction,
): Promise<Task | { httpStatus: number; message: string }> {
  // Kill the agent PTY before touching the worktree it lives in.
  if (task.ptySessionId) {
    try { deps.sessions.kill(task.ptySessionId); } catch { /* already gone */ }
  }
  const branch = task.branch!;
  const worktreePath = task.worktreePath!;

  if (action === "merged") {
    const merge = await gitMerge(project.path, branch, runGit);
    if (!merge.ok) {
      return { httpStatus: 409, message: merge.message };
    }
    await gitWorktreeRemove(project.path, worktreePath, runGit).catch(() => {});
    await gitDeleteBranch(project.path, branch, runGit).catch(() => {});
    updateTask(ctx.db, task.id, {
      status: "done", result: "merged", resultRef: merge.sha, worktreePath: null,
    });
    return getTaskById(ctx.db, task.id)!;
  }

  if (action === "pr") {
    try {
      await gitPush(project.path, branch, runGit);
    } catch (err) {
      return { httpStatus: 400, message: (err as Error).message };
    }
    let url: string;
    try {
      ({ url } = await ghCreatePr(project.path, { branch, title: task.title, body: task.intent }, runGh));
    } catch (err) {
      return { httpStatus: 400, message: (err as Error).message };
    }
    await gitWorktreeRemove(project.path, worktreePath, runGit).catch(() => {});
    updateTask(ctx.db, task.id, {
      status: "done", result: "pr", resultRef: url, worktreePath: null,
    });
    return getTaskById(ctx.db, task.id)!;
  }

  if (action === "detached") {
    updateTask(ctx.db, task.id, { status: "done", result: "detached" });
    return getTaskById(ctx.db, task.id)!;
  }

  // discarded
  await gitWorktreeRemove(project.path, worktreePath, runGit).catch(() => {});
  await gitDeleteBranch(project.path, branch, runGit).catch(() => {});
  updateTask(ctx.db, task.id, {
    status: "abandoned", result: "discarded", worktreePath: null,
  });
  return getTaskById(ctx.db, task.id)!;
}

export function projectTaskRoutes(deps: TaskRoutesDeps): Route[] {
  const runGit = deps.runGit ?? defaultRunGit;

  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/tasks$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json({ tasks: listTasksByProject(ctx.db, project.id) });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/tasks$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => null)) as
          | { intent?: string; baseBranch?: string; status?: string }
          | null;
        if (!body || typeof body.intent !== "string" || !body.intent.trim()) {
          return badRequest("intent is required");
        }
        let baseBranch = typeof body.baseBranch === "string" ? body.baseBranch.trim() : "";
        if (!baseBranch) {
          try {
            baseBranch = await gitCurrentBranch(project.path, runGit);
          } catch (err) {
            return badRequest(`could not resolve base branch: ${(err as Error).message}`);
          }
          if (!baseBranch) return badRequest("could not resolve the project's current branch");
        }
        const task = createTask(ctx.db, {
          projectId: project.id, intent: body.intent, baseBranch,
        });
        if (body.status === "running") {
          const launched = await launchTask(ctx, deps, runGit, project, task);
          if (launched instanceof Error) {
            // Launch failed before the task was usable — drop the draft.
            deleteTask(ctx.db, task.id);
            return badRequest(launched.message);
          }
          return json({ task: launched }, { status: 201 });
        }
        return json({ task }, { status: 201 });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["taskId"],
      handler: async (ctx) => {
        const task = getTaskById(ctx.db, ctx.params.taskId!);
        if (!task) return notFound();
        let diff: string | null = null;
        if (task.status === "review" && task.branch) {
          const project = getProjectById(ctx.db, task.projectId);
          if (project) {
            try {
              diff = await gitRangeDiff(project.path, task.baseBranch, task.branch, runGit);
            } catch {
              diff = null;
            }
          }
        }
        return json({ task, diff });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["taskId"],
      handler: async (ctx) => {
        const task = getTaskById(ctx.db, ctx.params.taskId!);
        if (!task) return notFound();
        const body = (await ctx.request.json().catch(() => null)) as
          | { status?: string; result?: string }
          | null;
        if (!body || typeof body.status !== "string") return badRequest("status is required");

        // Launch: draft → running.
        if (body.status === "running") {
          if (task.status !== "draft") {
            return json({ error: `cannot launch a ${task.status} task` }, { status: 422 });
          }
          const project = getProjectById(ctx.db, task.projectId);
          if (!project) return notFound();
          const launched = await launchTask(ctx, deps, runGit, project, task);
          if (launched instanceof Error) return badRequest(launched.message);
          return json({ task: launched });
        }

        // Completion: running|review → done|abandoned.
        const completion = COMPLETIONS[`${body.status}:${body.result ?? ""}`];
        if (!completion) {
          return json({ error: `unsupported transition: ${body.status}/${body.result}` }, { status: 422 });
        }
        if (task.status !== "running" && task.status !== "review") {
          return json({ error: `cannot complete a ${task.status} task` }, { status: 422 });
        }
        const project = getProjectById(ctx.db, task.projectId);
        if (!project) return notFound();
        const outcome = await completeTask(ctx, deps, runGit, deps.runGh ?? defaultRunGh, project, task, completion.result);
        if ("httpStatus" in outcome) {
          return json({ error: outcome.message }, { status: outcome.httpStatus });
        }
        return json({ task: outcome });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["taskId"],
      handler: (ctx) => {
        const task = getTaskById(ctx.db, ctx.params.taskId!);
        if (!task) return notFound();
        if (task.status !== "draft") {
          return json({ error: "only draft tasks can be deleted" }, { status: 422 });
        }
        deleteTask(ctx.db, task.id);
        return json({ ok: true });
      },
    },
  ];
}
