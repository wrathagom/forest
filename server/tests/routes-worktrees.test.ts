import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { worktreeRoutes } from "../src/routes/worktrees";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-wt-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string>) {
  return {
    db, log: () => {}, loop: { start() {}, stop() {} } as never,
    url: new URL(request.url), params, request,
  };
}

describe("POST /api/projects/:id/worktrees", () => {
  test("rejects when project missing", async () => {
    const db = openDb(":memory:");
    const route = worktreeRoutes().find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/projects/nope/worktrees", {
      method: "POST",
      body: JSON.stringify({ branch: "main", name: "feat" }),
    });
    const res = await route.handler(ctx(db, req, { id: "nope" }));
    expect(res.status).toBe(404);
  });

  test("creates a worktree under .worktrees/<name> and returns its path", async () => {
    const db = openDb(":memory:");
    const projPath = join(tmp, "proj");
    mkdirSync(projPath, { recursive: true });
    // init a real git repo with a branch so `git worktree add` succeeds
    Bun.spawnSync({ cmd: ["git", "init"], cwd: projPath });
    Bun.spawnSync({ cmd: ["git", "commit", "--allow-empty", "-m", "init"], cwd: projPath });
    Bun.spawnSync({ cmd: ["git", "branch", "feat"], cwd: projPath });
    const id = upsertProject(db, { path: projPath, name: "proj" });

    const route = worktreeRoutes().find((r) => r.method === "POST")!;
    const req = new Request(`http://x/api/projects/${id}/worktrees`, {
      method: "POST",
      body: JSON.stringify({ branch: "feat", name: "feat" }),
    });
    const res = await route.handler(ctx(db, req, { id }));
    expect(res.status).toBe(200);
    const body = await res.json() as { path: string };
    expect(body.path).toBe(join(projPath, ".worktrees", "feat"));
  });
});
