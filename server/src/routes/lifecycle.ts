// server/src/routes/lifecycle.ts
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById, updateProject } from "../store/projects";
import { computeLifecycle } from "../lifecycle/status";
import type { ForestConfig } from "../lifecycle/config";
import type { LifecycleRegistry } from "../lifecycle/registry";
import type { RunResult } from "../lifecycle/run";

export type LifecycleRoutesDeps = {
  registry: LifecycleRegistry;
  readConfig: (path: string) => ForestConfig | null;
  runCommand: (cmd: string, cwd: string, opts: { timeoutMs: number }) => Promise<RunResult>;
};

const START_STOP_TIMEOUT_MS = 120_000;

function view(deps: LifecycleRoutesDeps, project: { id: string; path: string; lifecycleEnabled: boolean }) {
  const config = deps.readConfig(project.path);
  const transient = deps.registry.transient(project.id);
  const status =
    transient ??
    computeLifecycle({
      enabled: project.lifecycleEnabled,
      hasConfig: config !== null,
      servicesUp: false, // steady up/down comes from the scan snapshot, not this endpoint
      health: null,
    });
  return {
    hasConfig: config !== null,
    enabled: project.lifecycleEnabled,
    config,
    status,
    lastRun: deps.registry.lastRun(project.id),
  };
}

export function lifecycleRoutes(deps: LifecycleRoutesDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json(view(deps, project));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle\/enable$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => ({}))) as { enabled?: boolean };
        if (typeof body.enabled !== "boolean") return badRequest("enabled (boolean) is required");
        updateProject(ctx.db, project.id, { lifecycleEnabled: body.enabled });
        return json(view(deps, { ...project, lifecycleEnabled: body.enabled }));
      },
    },
    ...(["start", "stop"] as const).map((kind): Route => ({
      method: "POST",
      pattern: new RegExp(`^\\/api\\/projects\\/([^/]+)\\/lifecycle\\/${kind}$`),
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!project.lifecycleEnabled) return badRequest("lifecycle is not enabled for this project");
        if (deps.registry.inFlight(project.id)) return json({ error: "a lifecycle command is already running" }, { status: 409 });
        const config = deps.readConfig(project.path);
        const cmd = config?.[kind];
        if (!cmd) return badRequest(`no ${kind} command in forest.yaml`);

        deps.registry.setTransient(project.id, kind === "start" ? "starting" : "stopping");
        try {
          const result = await deps.runCommand(cmd, project.path, { timeoutMs: START_STOP_TIMEOUT_MS });
          const failed = result.exitCode !== 0 || result.timedOut;
          deps.registry.setLastRun(project.id, { kind, exitCode: result.exitCode, output: result.output, at: Date.now(), failed });
          return json({ exitCode: result.exitCode, output: result.output, timedOut: result.timedOut, failed });
        } finally {
          deps.registry.clearTransient(project.id);
          // Reconcile the card status quickly (start/stop changed what's running).
          await ctx.loop.refresh(project.id).catch(() => null);
        }
      },
    })),
  ];
}
