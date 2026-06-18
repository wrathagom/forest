import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { createTask, getTaskById, listTasksByProject } from "../src/store/tasks";
import type { RunGit } from "../src/git";
import type { RunGh } from "../src/gh";
import { projectTaskRoutes, type TaskRoutesDeps } from "../src/routes/tasks";

/** Default fake git: branches absent, current branch "main", everything else OK. */
const okGit: RunGit = async (args) => {
  if (args[0] === "rev-parse" && args.includes("--verify")) {
    return { stdout: "", stderr: "", code: 1 }; // ref absent
  }
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
    return { stdout: "main\n", stderr: "", code: 0 };
  }
  return { stdout: "", stderr: "", code: 0 };
};

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string>) {
  return {
    db, log: () => {}, loop: { start() {}, stop() {} } as never,
    url: new URL(request.url), params, request,
  };
}

/** Minimal deps: no PTYs, git/gh stubbed to succeed. */
function deps(over: Partial<TaskRoutesDeps> = {}): TaskRoutesDeps {
  const runGit: RunGit = okGit;
  return {
    sessions: { create: () => ({ id: "pty-1" }), kill: () => {} },
    runGit,
    runGh: async () => ({ stdout: "", stderr: "", code: 0 }),
    ...over,
  };
}

function route(method: string, pattern: RegExp, d: TaskRoutesDeps) {
  return projectTaskRoutes(d).find((r) => r.method === method && String(r.pattern) === String(pattern))!;
}

const LIST = /^\/api\/projects\/([^/]+)\/tasks$/;
const ONE = /^\/api\/tasks\/([^/]+)$/;

describe("GET /api/projects/:id/tasks", () => {
  test("404 when project missing", async () => {
    const db = openDb(":memory:");
    const res = await route("GET", LIST, deps()).handler(
      ctx(db, new Request("http://x/api/projects/nope/tasks"), { id: "nope" }),
    );
    expect(res.status).toBe(404);
  });
  test("lists the project's tasks", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    createTask(db, { projectId: pid, intent: "one", baseBranch: "main" });
    const res = await route("GET", LIST, deps()).handler(
      ctx(db, new Request(`http://x/api/projects/${pid}/tasks`), { id: pid }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { tasks: unknown[] };
    expect(body.tasks.length).toBe(1);
  });
});

describe("POST /api/projects/:id/tasks (draft)", () => {
  test("creates a draft task", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST", body: JSON.stringify({ intent: "Add a thing", baseBranch: "main" }),
    });
    const res = await route("POST", LIST, deps()).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(201);
    const body = await res.json() as { task: { id: string; status: string } };
    expect(body.task.status).toBe("draft");
    expect(getTaskById(db, body.task.id)!.title).toBe("Add a thing");
  });
  test("400 when intent is empty", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST", body: JSON.stringify({ intent: "  " }),
    });
    const res = await route("POST", LIST, deps()).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks/:taskId", () => {
  test("returns the task", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    const res = await route("GET", ONE, deps()).handler(
      ctx(db, new Request(`http://x/api/tasks/${t.id}`), { taskId: t.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { task: { id: string }; diff: string | null };
    expect(body.task.id).toBe(t.id);
    expect(body.diff).toBeNull(); // not in review
  });
  test("includes the branch diff when status is review", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    db.query("UPDATE tasks SET status='review', branch='task/x' WHERE id=?").run(t.id);
    const runGit: RunGit = async (args) =>
      ({ stdout: args[0] === "diff" ? "DIFF-TEXT" : "", stderr: "", code: 0 });
    const res = await route("GET", ONE, deps({ runGit })).handler(
      ctx(db, new Request(`http://x/api/tasks/${t.id}`), { taskId: t.id }),
    );
    const body = await res.json() as { diff: string | null };
    expect(body.diff).toBe("DIFF-TEXT");
  });
  test("404 for unknown task", async () => {
    const db = openDb(":memory:");
    const res = await route("GET", ONE, deps()).handler(
      ctx(db, new Request("http://x/api/tasks/nope"), { taskId: "nope" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tasks/:taskId", () => {
  test("deletes a draft", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    const res = await route("DELETE", ONE, deps()).handler(
      ctx(db, new Request(`http://x/api/tasks/${t.id}`, { method: "DELETE" }), { taskId: t.id }),
    );
    expect(res.status).toBe(200);
    expect(getTaskById(db, t.id)).toBeUndefined();
  });
  test("422 when the task is not a draft", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    db.query("UPDATE tasks SET status='running' WHERE id=?").run(t.id);
    const res = await route("DELETE", ONE, deps()).handler(
      ctx(db, new Request(`http://x/api/tasks/${t.id}`, { method: "DELETE" }), { taskId: t.id }),
    );
    expect(res.status).toBe(422);
    expect(getTaskById(db, t.id)).toBeDefined();
  });
});

const PATCH = /^\/api\/tasks\/([^/]+)$/;

/** Deps that record git calls and hand out a fixed pty id. */
function launchDeps() {
  const gitCalls: string[][] = [];
  const created: Array<{ cwd: string; command: string; args: string[] }> = [];
  const runGit: RunGit = async (args, cwd) => {
    gitCalls.push(args);
    return okGit(args, cwd);
  };
  const d = deps({
    runGit,
    sessions: {
      create: (input) => { created.push(input); return { id: "pty-xyz" }; },
      kill: () => {},
    },
  });
  return { d, gitCalls, created };
}

describe("POST create-and-launch (status: running)", () => {
  test("creates worktree, spawns a claude PTY, records launch fields", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const { d, gitCalls, created } = launchDeps();
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST",
      body: JSON.stringify({ intent: "Add rate limiting", baseBranch: "main", status: "running" }),
    });
    const res = await route("POST", LIST, d).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(201);
    const { task } = await res.json() as { task: { id: string; status: string; branch: string } };
    expect(task.status).toBe("running");
    expect(task.branch).toBe("task/add-rate-limiting");

    const stored = getTaskById(db, task.id)!;
    expect(stored.worktreePath).toBe("/tmp/p/.worktrees/add-rate-limiting");
    expect(stored.ptySessionId).toBe("pty-xyz");
    expect(stored.sessionId).toBeTruthy();

    // git worktree add ran with -b <branch> <base>
    const add = gitCalls.find((c) => c[0] === "worktree" && c[1] === "add")!;
    expect(add).toEqual([
      "worktree", "add", "/tmp/p/.worktrees/add-rate-limiting", "-b", "task/add-rate-limiting", "main",
    ]);
    // claude spawned in the worktree with the task's session id
    expect(created[0]!.cwd).toBe("/tmp/p/.worktrees/add-rate-limiting");
    expect(created[0]!.command).toBe("claude");
    expect(created[0]!.args).toEqual([
      "--session-id", stored.sessionId!, "--permission-mode", "bypassPermissions", "Add rate limiting",
    ]);
  });
});

describe("PATCH /api/tasks/:taskId — launch a draft", () => {
  test("draft + {status:'running'} launches the task", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "Do work", baseBranch: "main" });
    const { d } = launchDeps();
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "running" }),
    });
    const res = await route("PATCH", PATCH, d).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(200);
    expect(getTaskById(db, t.id)!.status).toBe("running");
  });
  test("422 when launching a task that is not a draft", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    db.query("UPDATE tasks SET status='running' WHERE id=?").run(t.id);
    const { d } = launchDeps();
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "running" }),
    });
    const res = await route("PATCH", PATCH, d).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(422);
  });
  test("worktree-add failure → 400 and the task stays a draft", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    const runGit: RunGit = async (args, cwd) => {
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "fatal: branch exists\n", code: 1 };
      }
      return okGit(args, cwd);
    };
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "running" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(400);
    expect(getTaskById(db, t.id)!.status).toBe("draft");
  });
});

/** Seed a launched task in `review`, ready for completion. */
function launchedTask(db: ReturnType<typeof openDb>, pid: string) {
  const t = createTask(db, { projectId: pid, intent: "Do work", baseBranch: "main" });
  db.query(
    `UPDATE tasks SET status='review', branch='task/do-work',
       worktree_path='/tmp/p/.worktrees/do-work', session_id='sid', pty_session_id='pty-1'
     WHERE id=?`,
  ).run(t.id);
  return getTaskById(db, t.id)!;
}

describe("PATCH completion — discard", () => {
  test("removes worktree + branch, task → abandoned/discarded", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const gitCalls: string[][] = [];
    const killed: string[] = [];
    const runGit: RunGit = async (args) => { gitCalls.push(args); return { stdout: "", stderr: "", code: 0 }; };
    const d = deps({ runGit, sessions: { create: () => ({ id: "x" }), kill: (id) => killed.push(id) } });
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "abandoned", result: "discarded" }),
    });
    const res = await route("PATCH", PATCH, d).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(200);
    expect(killed).toEqual(["pty-1"]);
    expect(gitCalls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(true);
    expect(gitCalls.some((c) => c[0] === "branch" && c[1] === "-D")).toBe(true);
    const done = getTaskById(db, t.id)!;
    expect(done.status).toBe("abandoned");
    expect(done.result).toBe("discarded");
    expect(done.worktreePath).toBeNull();
  });
});

describe("PATCH completion — detach", () => {
  test("keeps the worktree, task → done/detached", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const gitCalls: string[][] = [];
    const runGit: RunGit = async (args) => { gitCalls.push(args); return { stdout: "", stderr: "", code: 0 }; };
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "detached" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(200);
    expect(gitCalls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
    const done = getTaskById(db, t.id)!;
    expect(done.status).toBe("done");
    expect(done.result).toBe("detached");
    expect(done.worktreePath).toBe("/tmp/p/.worktrees/do-work");
  });
});

describe("PATCH completion — merge", () => {
  test("clean merge → done/merged with the merge sha", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const runGit: RunGit = async (args) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "merge") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "rev-parse") return { stdout: "merged-sha\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "merged" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(200);
    const done = getTaskById(db, t.id)!;
    expect(done.status).toBe("done");
    expect(done.result).toBe("merged");
    expect(done.resultRef).toBe("merged-sha");
    expect(done.worktreePath).toBeNull();
  });
  test("merge conflict → 409, task left in review", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const runGit: RunGit = async (args) => {
      if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "merge") return { stdout: "", stderr: "CONFLICT\n", code: 1 };
      if (args[0] === "rev-parse") return { stdout: "merge-head\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "merged" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(409);
    expect(getTaskById(db, t.id)!.status).toBe("review");
  });
  test("dirty main checkout → 409", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const runGit: RunGit = async (args) =>
      args[0] === "status"
        ? { stdout: " M other.ts\n", stderr: "", code: 0 }
        : { stdout: "", stderr: "", code: 0 };
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "merged" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(409);
  });
});

describe("PATCH completion — pr", () => {
  test("pushes, opens a PR, task → done/pr with the PR url", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const gitCalls: string[][] = [];
    const runGit: RunGit = async (args) => { gitCalls.push(args); return { stdout: "", stderr: "", code: 0 }; };
    const runGh: RunGh = async () =>
      ({ stdout: "https://github.com/me/p/pull/9\n", stderr: "", code: 0 });
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "pr" }),
    });
    const res = await route("PATCH", PATCH, deps({ runGit, runGh })).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(200);
    expect(gitCalls.some((c) => c[0] === "push")).toBe(true);
    const done = getTaskById(db, t.id)!;
    expect(done.status).toBe("done");
    expect(done.result).toBe("pr");
    expect(done.resultRef).toBe("https://github.com/me/p/pull/9");
    expect(done.worktreePath).toBeNull();
  });
});

describe("PATCH completion — guards", () => {
  test("422 when completing a draft task", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = createTask(db, { projectId: pid, intent: "x", baseBranch: "main" });
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "merged" }),
    });
    const res = await route("PATCH", PATCH, deps()).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(422);
  });
  test("422 on an unknown {status,result} pair", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const t = launchedTask(db, pid);
    const req = new Request(`http://x/api/tasks/${t.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", result: "bogus" }),
    });
    const res = await route("PATCH", PATCH, deps()).handler(ctx(db, req, { taskId: t.id }));
    expect(res.status).toBe(422);
  });
});

describe("base branch resolution", () => {
  test("create without baseBranch resolves the project's current branch", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const runGit: RunGit = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return { stdout: "develop\n", stderr: "", code: 0 };
      }
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        return { stdout: "", stderr: "", code: 1 }; // branch absent
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST", body: JSON.stringify({ intent: "x" }),
    });
    const res = await route("POST", LIST, deps({ runGit })).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(201);
    const { task } = await res.json() as { task: { id: string } };
    expect(getTaskById(db, task.id)!.baseBranch).toBe("develop");
  });
});

describe("freeSlug branch collision", () => {
  test("launch bumps the slug when the task/<slug> branch already exists", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const created: Array<{ cwd: string }> = [];
    const runGit: RunGit = async (args) => {
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        // task/add-rate-limiting exists; the -2 variant does not
        const exists = args.includes("refs/heads/task/add-rate-limiting");
        return { stdout: "", stderr: "", code: exists ? 0 : 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const d = deps({
      runGit,
      sessions: { create: (i) => { created.push(i); return { id: "pty-1" }; }, kill: () => {} },
    });
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST",
      body: JSON.stringify({ intent: "Add rate limiting", baseBranch: "main", status: "running" }),
    });
    const res = await route("POST", LIST, d).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(201);
    const { task } = await res.json() as { task: { branch: string } };
    expect(task.branch).toBe("task/add-rate-limiting-2");
  });
});

describe("create-and-launch rollback", () => {
  test("PTY spawn failure rolls back the worktree and drops the draft", async () => {
    const db = openDb(":memory:");
    const pid = upsertProject(db, { path: "/tmp/p", name: "p" });
    const gitCalls: string[][] = [];
    const runGit: RunGit = async (args, cwd) => { gitCalls.push(args); return okGit(args, cwd); };
    const d = deps({
      runGit,
      sessions: { create: () => { throw new Error("pty boom"); }, kill: () => {} },
    });
    const req = new Request(`http://x/api/projects/${pid}/tasks`, {
      method: "POST",
      body: JSON.stringify({ intent: "x", baseBranch: "main", status: "running" }),
    });
    const res = await route("POST", LIST, d).handler(ctx(db, req, { id: pid }));
    expect(res.status).toBe(400);
    expect(gitCalls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(true);
    expect(gitCalls.some((c) => c[0] === "branch" && c[1] === "-D")).toBe(true);
    expect(listTasksByProject(db, pid).length).toBe(0);
  });
});
