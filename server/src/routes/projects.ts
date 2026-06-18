import { json, notFound, badRequest } from "../server";
import type { Route, RouteCtx } from "../server";
import {
  listProjects,
  getProjectById,
  updateProject,
  type ProjectListView,
} from "../store/projects";
import { getSnapshotByProjectId } from "../store/snapshots";
import { getScanRoot, getPollIntervalMs } from "../store/config";
import type { SessionRegistry } from "../sessions/registry";
import type { AgentDetector } from "../sessions/agent-detect";

function projectListPayload(
  ctx: RouteCtx,
  view: ProjectListView,
  sessions?: SessionRegistry,
  detector?: AgentDetector,
) {
  if (detector) detector.bumpActivity();
  const projects = listProjects(ctx.db, view).map((p) => {
    const stored = getSnapshotByProjectId(ctx.db, p.id);
    const liveAgents: Array<{ agent: string; count: number }> = (() => {
      if (!sessions) return [];
      const counts: Record<string, number> = {};
      for (const s of sessions.listByProject(p.id)) {
        const agent = s.launcher?.agent ?? detector?.get(s.pty.pid) ?? null;
        if (!agent) continue;
        counts[agent] = (counts[agent] ?? 0) + 1;
      }
      return Object.entries(counts).map(([agent, count]) => ({ agent, count }));
    })();
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      pinned: p.pinned,
      hidden: p.hidden,
      group: p.group,
      snapshot: stored?.snapshot ?? null,
      scannedAt: stored?.scannedAt ?? null,
      liveSessions: sessions?.countByProject(p.id) ?? 0,
      liveAgents,
    };
  });
  return {
    projects,
    scanRoot: getScanRoot(ctx.db) ?? null,
    pollIntervalMs: getPollIntervalMs(ctx.db),
  };
}

export function projectRoutes(sessions?: SessionRegistry, detector?: AgentDetector): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects$/,
      handler: (ctx) => {
        const raw = ctx.url.searchParams.get("view");
        const view: ProjectListView =
          raw === "archived" ? "archived" : raw === "all" ? "all" : "default";
        return json(projectListPayload(ctx, view, sessions, detector));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const stored = getSnapshotByProjectId(ctx.db, project.id);
        return json({
          id: project.id,
          name: project.name,
          path: project.path,
          pinned: project.pinned,
          hidden: project.hidden,
          group: project.group,
          snapshot: stored?.snapshot ?? null,
          scannedAt: stored?.scannedAt ?? null,
          liveSessions: sessions?.countByProject(project.id) ?? 0,
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/refresh$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const snap = await ctx.loop.refresh(project.id);
        if (!snap) return notFound();
        return json({ id: project.id, snapshot: snap, scannedAt: Date.now() });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/projects\/([^/]+)$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => null)) as
          | { pinned?: boolean; hidden?: boolean; name?: string; group?: string | null }
          | null;
        if (!body) return badRequest("invalid JSON");
        updateProject(ctx.db, project.id, body);
        return json({ ok: true });
      },
    },
  ];
}
