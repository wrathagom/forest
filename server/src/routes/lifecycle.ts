// server/src/routes/lifecycle.ts
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById, updateProject } from "../store/projects";
import { getSnapshotByProjectId } from "../store/snapshots";
import { computeLifecycle, computeSectionStatus } from "../lifecycle/status";
import type { LifecycleStatus } from "../lifecycle/status";
import type { ForestConfig, LifecycleSection, ConfigResult } from "../lifecycle/config";
import type { LifecycleRegistry, LastRun } from "../lifecycle/registry";
import type { RunResult } from "../lifecycle/run";

export type LifecycleRoutesDeps = {
  registry: LifecycleRegistry;
  readConfig: (path: string) => ForestConfig | null;
  /**
   * Richer read used only by the GET view, so it can report a present-but-broken
   * forest.yaml. Optional: defaults to `readConfig` with a null parseError, which
   * keeps the start/stop handlers (which only need the config) unchanged.
   */
  readConfigResult?: (path: string) => ConfigResult;
  runCommand: (cmd: string, cwd: string, opts: { timeoutMs: number }) => Promise<RunResult>;
};

const START_STOP_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

type SectionView = {
  name: string;
  config: LifecycleSection;
  status: LifecycleStatus;
  lastRun: LastRun | null;
};

/**
 * Live status for one section: its registry transient if a command is running,
 * otherwise its health probe (`healthy`/`stopped`), or `none` when it has no
 * health command. Health runs here (not at scan time) so the polled panel sees
 * fresh status without touching the scanner or the dashboard card.
 */
async function sectionView(
  deps: LifecycleRoutesDeps,
  projectId: string,
  projectPath: string,
  name: string,
  section: LifecycleSection,
): Promise<SectionView> {
  const transient = deps.registry.transient(projectId, name);
  let status: LifecycleStatus;
  if (transient) {
    status = transient;
  } else if (section.health) {
    let health: { exitCode: number } | null;
    try {
      const r = await deps.runCommand(section.health, projectPath, { timeoutMs: HEALTH_TIMEOUT_MS });
      health = { exitCode: r.exitCode };
    } catch {
      health = { exitCode: 1 };
    }
    status = computeSectionStatus({ hasHealth: true, health });
  } else {
    status = computeSectionStatus({ hasHealth: false, health: null });
  }
  return { name, config: section, status, lastRun: deps.registry.lastRun(projectId, name) };
}

async function view(
  deps: LifecycleRoutesDeps,
  db: import("bun:sqlite").Database,
  project: { id: string; path: string; lifecycleEnabled: boolean },
) {
  const { config, parseError } = deps.readConfigResult
    ? deps.readConfigResult(project.path)
    : { config: deps.readConfig(project.path), parseError: null };
  const transient = deps.registry.transient(project.id);
  const stored = getSnapshotByProjectId(db, project.id);
  const status =
    transient ??
    stored?.snapshot.lifecycle?.status ??
    computeLifecycle({
      enabled: project.lifecycleEnabled,
      hasConfig: config !== null,
      servicesUp: false, // no snapshot yet — best-effort until the first scan
      health: null,
    });

  const sectionEntries = Object.entries(config?.sections ?? {}).sort(([a], [b]) => a.localeCompare(b));
  // Never execute a section's health command for a project the user hasn't
  // enabled — mirrors augmentWithLifecycle's invariant that a discovered-but-
  // not-enabled repo runs nothing. Disabled sections report `none`.
  const sections: SectionView[] = project.lifecycleEnabled
    ? await Promise.all(
        sectionEntries.map(([name, sec]) => sectionView(deps, project.id, project.path, name, sec)),
      )
    : sectionEntries.map(([name, sec]) => ({
        name,
        config: sec,
        status: "none" as const,
        lastRun: deps.registry.lastRun(project.id, name),
      }));

  return {
    hasConfig: config !== null,
    parseError,
    enabled: project.lifecycleEnabled,
    config,
    status,
    lastRun: deps.registry.lastRun(project.id),
    sections,
  };
}

export function lifecycleRoutes(deps: LifecycleRoutesDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json(await view(deps, ctx.db, project));
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
        await ctx.loop.refresh(project.id).catch(() => null);
        return json(await view(deps, ctx.db, { ...project, lifecycleEnabled: body.enabled }));
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
    ...(["start", "stop"] as const).map((kind): Route => ({
      method: "POST",
      pattern: new RegExp(`^\\/api\\/projects\\/([^/]+)\\/lifecycle\\/sections\\/([^/]+)\\/${kind}$`),
      paramNames: ["id", "section"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!project.lifecycleEnabled) return badRequest("lifecycle is not enabled for this project");
        const name = ctx.params.section!;
        const config = deps.readConfig(project.path);
        const section = config?.sections?.[name];
        if (!section) return notFound();
        if (deps.registry.inFlight(project.id, name)) return json({ error: "a lifecycle command is already running for this section" }, { status: 409 });
        const cmd = section[kind];
        if (!cmd) return badRequest(`no ${kind} command in section '${name}'`);

        deps.registry.setTransient(project.id, kind === "start" ? "starting" : "stopping", name);
        try {
          const result = await deps.runCommand(cmd, project.path, { timeoutMs: START_STOP_TIMEOUT_MS });
          const failed = result.exitCode !== 0 || result.timedOut;
          deps.registry.setLastRun(project.id, { kind, exitCode: result.exitCode, output: result.output, at: Date.now(), failed }, name);
          return json({ exitCode: result.exitCode, output: result.output, timedOut: result.timedOut, failed });
        } finally {
          deps.registry.clearTransient(project.id, name);
          await ctx.loop.refresh(project.id).catch(() => null);
        }
      },
    })),
  ];
}
