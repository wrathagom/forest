import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Vault } from "./vault";
import type { LiveAgentSessions } from "./live";
import { classifyCwd } from "./scanner";

export type PermissionMode = "plan" | "acceptEdits" | "bypassPermissions";
export const PERMISSION_MODES: readonly PermissionMode[] = ["plan", "acceptEdits", "bypassPermissions"];

export type SpawnedProc = {
  pid: number;
  exited: Promise<number>;
  kill(signal?: string): void;
};

export type SpawnFn = (opts: { cmd: string[]; cwd: string; env: Record<string, string> }) => SpawnedProc;

export const bunSpawn: SpawnFn = ({ cmd, cwd, env }) => {
  const proc = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return {
    pid: proc.pid,
    exited: proc.exited,
    kill: (sig?: string) => proc.kill(sig as never),
  };
};

type Logger = (level: string, msg: string, meta?: Record<string, unknown>) => void;

export type AgentRunnerDeps = {
  vault: Vault;
  liveSessions: LiveAgentSessions;
  listProjects: () => Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
  /** Returns a writer for the live PTY running this agent session, iff it's safe to type
   *  into right now (the session is paused on the user). Null otherwise. */
  ptyWriterFor: (agentSessionId: string) => ((data: string) => void) | null;
  spawn?: SpawnFn;
  claudeBin?: string;
  log?: Logger;
};

export class AgentRunner {
  private readonly spawnFn: SpawnFn;
  private readonly claudeBin: string;
  private readonly log: Logger;
  private readonly live = new Map<string, SpawnedProc>();

  constructor(private readonly deps: AgentRunnerDeps) {
    this.spawnFn = deps.spawn ?? bunSpawn;
    this.claudeBin = deps.claudeBin ?? "claude";
    this.log = deps.log ?? (() => {});
  }

  async launch(input: { projectId: string; prompt: string; permissionMode: PermissionMode }): Promise<{ sessionId: string }> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("prompt is required");
    const project = this.deps.listProjects().find((p) => p.id === input.projectId);
    if (!project) throw new Error(`unknown project: ${input.projectId}`);
    if (!existsSync(project.path)) throw new Error(`checkout missing: ${project.path}`);
    const sid = randomUUID();
    const { worktreeLabel } = classifyCwd(project.path, [project]);
    const now = Date.now();
    this.deps.vault.upsertSession({
      session_id: sid, agent: "claude", cwd: project.path,
      started_at: now, last_activity: now, first_user_msg: prompt,
      project_id: project.id, worktree_label: worktreeLabel, cwd_exists: true,
      source: "mobile", launched_via: "mobile", permission_mode: input.permissionMode,
    });
    this.deps.liveSessions.noteHeadlessRunStarted({
      agentSessionId: sid, projectId: project.id, projectName: this.deps.projectName(project.id),
      cwd: project.path, worktreeLabel, branch: null, prompt,
    });
    // Deliberate: if spawn throws, the vault row + live "working" entry are already written and will
    // look misleading until the entry idles out — acceptable because nothing leaks and it self-heals.
    this.spawnRun({
      cmd: [this.claudeBin, "-p", prompt, "--session-id", sid, "--permission-mode", input.permissionMode],
      cwd: project.path, sessionId: sid,
    });
    return { sessionId: sid };
  }

  async reply(input: { sessionId: string; text: string }): Promise<void> {
    const text = input.text.trim();
    if (!text) throw new Error("text is required");
    const writer = this.deps.ptyWriterFor(input.sessionId);
    if (writer) { writer(text + "\r"); return; }
    const row = this.deps.vault.getSession(input.sessionId);
    if (!row) throw new Error(`unknown session: ${input.sessionId}`);
    const liveEntry = this.deps.liveSessions.getEntry(input.sessionId);
    if (liveEntry && liveEntry.endedAt === null && liveEntry.state === "working") {
      throw new Error("session is busy — reply once it's waiting on you");
    }
    const mode: PermissionMode = (PERMISSION_MODES as readonly string[]).includes(row.permission_mode ?? "")
      ? (row.permission_mode as PermissionMode) : "acceptEdits";
    const cwd = existsSync(row.cwd) ? row.cwd
      : (this.deps.listProjects().find((p) => p.id === row.project_id)?.path ?? row.cwd);
    this.deps.liveSessions.noteHeadlessRunStarted({
      agentSessionId: input.sessionId, projectId: row.project_id,
      projectName: row.project_id ? this.deps.projectName(row.project_id) : null,
      cwd, worktreeLabel: row.worktree_label, branch: row.branch, prompt: text,
    });
    this.spawnRun({
      cmd: [this.claudeBin, "-p", text, "--resume", input.sessionId, "--permission-mode", mode],
      cwd, sessionId: input.sessionId,
    });
  }

  shutdown(): void {
    for (const proc of this.live.values()) {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
    this.live.clear();
  }

  private spawnRun(args: { cmd: string[]; cwd: string; sessionId: string }): void {
    let proc: SpawnedProc;
    try {
      proc = this.spawnFn({ cmd: args.cmd, cwd: args.cwd, env: process.env as Record<string, string> });
    } catch (err) {
      this.log("warn", "agent-run spawn failed", { sessionId: args.sessionId, error: (err as Error).message });
      throw new Error(`failed to start claude: ${(err as Error).message}`);
    }
    this.live.set(args.sessionId, proc);
    proc.exited
      .then((code) => {
        if (this.live.get(args.sessionId) === proc) this.live.delete(args.sessionId);
        this.log("info", "agent-run exited", { sessionId: args.sessionId, code });
      })
      .catch(() => {
        if (this.live.get(args.sessionId) === proc) this.live.delete(args.sessionId);
      });
  }
}
