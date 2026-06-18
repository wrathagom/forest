import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById } from "../store/projects";
import { join } from "node:path";

export function worktreeRoutes(): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/worktrees$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => null)) as
          | { branch?: string; name?: string }
          | null;
        if (!body?.branch || !body?.name) return badRequest("branch and name are required");
        if (!/^[A-Za-z0-9._-]+$/.test(body.name)) return badRequest("invalid worktree name");
        const dest = join(project.path, ".worktrees", body.name);
        const proc = Bun.spawnSync({
          cmd: ["git", "worktree", "add", dest, body.branch],
          cwd: project.path,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (proc.exitCode !== 0) {
          const stderr = new TextDecoder().decode(proc.stderr);
          return json({ error: stderr || "git worktree add failed" }, { status: 400 });
        }
        return json({ path: dest });
      },
    },
  ];
}
