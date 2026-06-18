import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById } from "../store/projects";
import { getLaunchers } from "../store/config";
import type { SessionRegistry } from "../sessions/registry";
import type { Session } from "../sessions/types";
import type { AgentDetector } from "../sessions/agent-detect";

function sessionPayload(s: Session, detector?: AgentDetector) {
  return {
    id: s.id,
    projectId: s.projectId,
    cwd: s.cwd,
    command: s.command,
    args: s.args,
    createdAt: s.createdAt,
    launcher: s.launcher ?? null,
    agent: s.launcher?.agent ?? detector?.get(s.pty.pid) ?? null,
  };
}

export function sessionRoutes(registry: SessionRegistry, detector?: AgentDetector): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/sessions$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => null)) as
          | { cwd?: string; command?: string; args?: string[]; cols?: number; rows?: number; launcherId?: string }
          | null;
        if (!body || typeof body.cols !== "number" || typeof body.rows !== "number") {
          return badRequest("cols and rows are required numbers");
        }
        let launcher: { id: string; agent?: string } | undefined;
        let command = body.command;
        let args = body.args;
        if (typeof body.launcherId === "string") {
          const entry = getLaunchers(ctx.db).find((l) => l.id === body.launcherId);
          if (!entry) return badRequest(`unknown launcher: ${body.launcherId}`);
          launcher = { id: entry.id, agent: entry.agent };
          command = entry.command ?? undefined;
          args = entry.args;
        } else if (command === "claude") {
          // Resume/relaunch flows pass raw command + args without a launcherId; tag them
          // so resolveLaunchEnv sees agent=claude and can pin CLAUDE_CONFIG_DIR.
          launcher = { id: "implicit-claude", agent: "claude" };
        }
        try {
          const s = registry.create({
            projectId: project.id,
            cwd: body.cwd ?? project.path,
            command,
            args,
            cols: body.cols,
            rows: body.rows,
            launcher,
          });
          return json(sessionPayload(s));
        } catch (err) {
          const msg = (err as Error).message;
          const status = /limit/i.test(msg) ? 429 : 400;
          return json({ error: msg }, { status });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/sessions$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json(registry.listByProject(project.id).map((s) => sessionPayload(s, detector)));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/sessions\/([^/]+)$/,
      paramNames: ["sid"],
      handler: (ctx) => {
        const s = registry.get(ctx.params.sid!);
        if (!s) return notFound();
        registry.kill(s.id);
        return json({ ok: true });
      },
    },
  ];
}
