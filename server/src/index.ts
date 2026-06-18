import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { dataDir, dbPath } from "./paths";
import { openDb } from "./store/db";
import { listVisibleProjects } from "./store/projects";
import { upsertSnapshot } from "./store/snapshots";
import {
  getPollIntervalMs,
  getSessionMaxTotal,
  getSessionMaxScrollbackLines,
  getSessionDefaultShell,
  getAgentSessionsInstallHooks,
  getBbsConfig,
} from "./store/config";
import { BbsClient } from "./bbs/client";
import { BbsPublisher } from "./bbs/publisher";
import { bbsRoutes } from "./routes/bbs";
import { scanProject } from "./scanner";
import { probeGit } from "./scanner/git";
import { defaultDockerProbe, defaultContainerDetailProbe } from "./scanner/docker";
import { defaultProcessProbe, defaultProcessDetailProbe } from "./scanner/processes";
import { discoverRepos } from "./discovery";
import { createLoop } from "./loop";
import { startServer } from "./server";
import { projectRoutes } from "./routes/projects";
import { configRoutes } from "./routes/config";
import { discoverRoutes } from "./routes/discover";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/sessions";
import { projectInfoRoutes } from "./routes/project-info";
import { projectCreateRoutes } from "./routes/projects-create";
import { projectFilesRoutes } from "./routes/files";
import { projectGitRoutes } from "./routes/git";
import { resolveLaunchEnv } from "./sessions/claude-profile-resolver";
import { SessionRegistry } from "./sessions/registry";
import { nodePtyFactory } from "./sessions/pty";
import { makeLogger } from "./log";
import { Vault } from "./sessions/vault";
import { AgentDetector } from "./sessions/agent-detect";
import { installHooks } from "./sessions/hook-installer";
import { scanClaudeProjects } from "./sessions/scanner";
import { discoverClaudeConfigDirs } from "./sessions/config-dirs";
import { LiveAgentSessions } from "./sessions/live";
import { makeDismissalStore } from "./store/dismissals";
import { AgentRunner } from "./sessions/runner";
import { agentSessionsRoutes } from "./routes/agent-sessions";
import { sessionsOverviewRoutes } from "./routes/sessions-overview";
import { worktreeRoutes } from "./routes/worktrees";
import { projectTaskRoutes } from "./routes/tasks";
import { reconcileTasks } from "./store/tasks";
import { defaultRunGit } from "./git";
import { defaultRunGh } from "./gh";
import { mobileRoutes } from "./routes/mobile";
import { createCaffeinate } from "./caffeinate";
import { caffeinateRoutes } from "./routes/caffeinate";

mkdirSync(dataDir(), { recursive: true });
mkdirSync(join(dataDir(), "logs"), { recursive: true });
const db = openDb(dbPath());
const caffeinate = createCaffeinate({ db });
caffeinate.init();
const log = makeLogger();

const probes = { git: probeGit, docker: defaultDockerProbe, processes: defaultProcessProbe };

let bbsPublisher: BbsPublisher | undefined;
const liveSessions = new LiveAgentSessions({
  dismissals: makeDismissalStore(db),
  onChange: (c) => bbsPublisher?.notifyChange(c),
});

const sessions = new SessionRegistry({
  pty: nodePtyFactory,
  maxTotal: getSessionMaxTotal(db),
  maxScrollbackBytes: getSessionMaxScrollbackLines(db) * 200, // ~200 bytes per line
  defaultShell: getSessionDefaultShell(db),
  liveSessions,
  resolveLaunchEnv: (input) => resolveLaunchEnv(
    { vault, configDirs, log },
    { agent: input.launcher?.agent, cwd: input.cwd, args: input.args },
  ),
});

const loop = createLoop({
  intervalMs: getPollIntervalMs(db),
  listVisible: () => listVisibleProjects(db).map((p) => ({ id: p.id, path: p.path })),
  scanProject: (path) => scanProject(path, probes),
  onSnapshot: (id, snap) => upsertSnapshot(db, id, snap),
  log,
});

const detector = new AgentDetector();
const agentNames = ["claude", "codex", "aider"];

setInterval(() => {
  const allPids: number[] = [];
  for (const p of listVisibleProjects(db)) {
    allPids.push(...sessions.livePidsByProject(p.id));
  }
  if (allPids.length === 0) return;
  void detector.refresh({ ptyPids: allPids, agentNames });
}, 3_000);

setInterval(() => liveSessions.prune(), 60_000);

// Mirror each running/review Task's status onto its agent's live state.
setInterval(() => {
  try {
    reconcileTasks(db, (sid) => liveSessions.getEntry(sid)?.state);
  } catch (err) {
    log("warn", "tasks: reconcile failed", { error: (err as Error).message });
  }
}, 3_000);

// Re-discover Claude config dirs (e.g. a new multi-claude profile dir appeared),
// re-install hooks into any new ones, and re-scan. Cheap: one readdir of $HOME
// plus mtime-guarded transcript scans.
setInterval(() => {
  installHooksIfEnabled();
  void scanAllProfiles("periodic scan");
}, 30_000);

const port = parseInt(process.env.FOREST_PORT ?? "52810", 10);
const staticDir = process.env.FOREST_STATIC_DIR ?? join(dirname(new URL(import.meta.url).pathname), "../../web/dist");

const vault = new Vault(db);

const bbsClient = new BbsClient({ baseUrl: getBbsConfig(db).baseUrl });
bbsPublisher = new BbsPublisher({
  client: bbsClient,
  getConfig: () => getBbsConfig(db),
  list: () => liveSessions.list(50),
  now: () => Date.now(),
  log,
});
bbsPublisher.startHeartbeat();

const projectNameById = (id: string) => listVisibleProjects(db).find((p) => p.id === id)?.name ?? null;
const projectsForRunner = () => listVisibleProjects(db).map((p) => ({ id: p.id, path: p.path }));

const runner = new AgentRunner({
  vault,
  liveSessions,
  listProjects: projectsForRunner,
  projectName: projectNameById,
  ptyWriterFor: (agentSessionId) => {
    const entry = liveSessions.getEntry(agentSessionId);
    if (!entry || entry.endedAt !== null || entry.state !== "waiting" || !entry.ptySessionId) return null;
    const s = sessions.get(entry.ptySessionId);
    if (!s) return null;
    return (data) => s.pty.write(data);
  },
  log,
});

function shutdown(): void {
  try { runner.shutdown(); } catch { /* ignore */ }
}
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);

function configDirs() {
  return discoverClaudeConfigDirs(homedir());
}

function installHooksIfEnabled() {
  if (!getAgentSessionsInstallHooks(db)) return;
  try {
    const r = installHooks({ dataDir: dataDir(), configDirs: configDirs(), port });
    log("info", "agent-sessions: hooks installed", { profiles: r.settings.map((s) => s.profile) });
  } catch (err) {
    log("warn", "agent-sessions: hook install failed", { error: (err as Error).message });
  }
}

function scanAllProfiles(reason: string) {
  return scanClaudeProjects({
    db,
    vault,
    configDirs: configDirs(),
    projects: listVisibleProjects(db).map((p) => ({ id: p.id, path: p.path })),
  })
    .then((r) => log("info", `agent-sessions: ${reason}`, r))
    .catch((err) => log("warn", `agent-sessions: ${reason} failed`, { error: (err as Error).message }));
}

installHooksIfEnabled();

// Initial scan (fire and forget) — backfills existing history.
void scanAllProfiles("initial scan");

startServer({
  port,
  db,
  loop,
  log,
  staticDir,
  sessions,
  routes: [
    ...projectRoutes(sessions, detector),
    ...configRoutes({ claudeConfigDirs: configDirs }),
    ...discoverRoutes({ runDiscover: (root) => discoverRepos(root) }),
    ...healthRoutes({ dockerReachable: async () => true }),
    ...caffeinateRoutes(caffeinate),
    ...sessionRoutes(sessions, detector),
    ...projectInfoRoutes({
      processes: (path) => defaultProcessDetailProbe(path),
      containers: (path) => defaultContainerDetailProbe(path),
    }),
    ...projectCreateRoutes(),
    ...projectFilesRoutes(),
    ...projectGitRoutes(),
    ...agentSessionsRoutes({
      vault,
      listProjects: () => listVisibleProjects(db).map((p) => ({ id: p.id, path: p.path })),
      claudeConfigDirs: configDirs,
      liveSessions,
      projectName: (id) => listVisibleProjects(db).find((p) => p.id === id)?.name ?? null,
    }),
    ...sessionsOverviewRoutes({ vault }),
    ...worktreeRoutes(),
    ...projectTaskRoutes({ sessions, runGit: defaultRunGit, runGh: defaultRunGh }),
    ...mobileRoutes({ runner, vault, liveSessions, listProjects: projectsForRunner, projectName: projectNameById }),
    ...bbsRoutes({ client: bbsClient, publisher: bbsPublisher! }),
  ],
});

loop.start();
log("info", "forest started", { port, staticDir });
