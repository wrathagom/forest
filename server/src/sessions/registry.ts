import { randomUUID } from "node:crypto";
import { ScrollbackRingBuffer } from "./ringbuffer";
import type { PtyFactory, Session } from "./types";

export type RegistryDeps = {
  pty: PtyFactory;
  maxTotal: number;
  maxScrollbackBytes: number;
  defaultShell: string;
  coalesceMs?: number;
  exitRetentionMs?: number;
  liveSessions?: { markEndedByPty(ptySessionId: string): void };
  resolveLaunchEnv?: (input: {
    cwd: string;
    args: string[];
    launcher?: { id: string; agent?: string };
  }) => Record<string, string>;
};

type FanoutTick = { pending: string; timer: ReturnType<typeof setTimeout> | null };

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly fanouts = new Map<string, FanoutTick>();
  private readonly coalesceMs: number;
  private readonly exitRetentionMs: number;

  constructor(private readonly deps: RegistryDeps) {
    this.coalesceMs = deps.coalesceMs ?? 16;
    this.exitRetentionMs = deps.exitRetentionMs ?? 30_000;
  }

  create(input: {
    projectId: string;
    cwd: string;
    command?: string;
    args?: string[];
    cols: number;
    rows: number;
    launcher?: { id: string; agent?: string };
  }): Session {
    if (this.sessions.size >= this.deps.maxTotal) {
      throw new Error("session limit reached");
    }
    const command = input.command ?? this.deps.defaultShell;
    const args = input.args ?? [];
    const id = randomUUID();
    const extraEnv = this.deps.resolveLaunchEnv?.({
      cwd: input.cwd,
      args,
      launcher: input.launcher,
    }) ?? {};
    const env = { ...(process.env as Record<string, string>), ...extraEnv, FOREST_PTY: id };
    const pty = this.deps.pty({
      command,
      args,
      cwd: input.cwd,
      env,
      cols: input.cols,
      rows: input.rows,
    });
    const session: Session = {
      id,
      projectId: input.projectId,
      cwd: input.cwd,
      command,
      args,
      pty,
      createdAt: Date.now(),
      scrollback: new ScrollbackRingBuffer(this.deps.maxScrollbackBytes),
      attachments: new Set(),
      launcher: input.launcher,
    };
    this.sessions.set(id, session);
    this.fanouts.set(id, { pending: "", timer: null });

    pty.onData((data) => this.onPtyData(session, data));
    pty.onExit(({ exitCode }) => this.onPtyExit(session, exitCode));
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listByProject(projectId: string): Session[] {
    const out: Session[] = [];
    for (const s of this.sessions.values()) if (s.projectId === projectId) out.push(s);
    return out;
  }

  countByProject(projectId: string): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.projectId === projectId) n++;
    return n;
  }

  livePidsByProject(projectId: string): number[] {
    const out: number[] = [];
    for (const s of this.sessions.values()) {
      if (s.projectId === projectId) out.push(s.pty.pid);
    }
    return out;
  }

  agentCountByProject(projectId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.sessions.values()) {
      if (s.projectId !== projectId) continue;
      const agent = s.launcher?.agent;
      if (!agent) continue;
      out[agent] = (out[agent] ?? 0) + 1;
    }
    return out;
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.kill("SIGHUP");
    } catch {
      // already dead
    }
    this.dropSession(session);
  }

  killAllForProject(projectId: string): void {
    for (const s of [...this.sessions.values()]) if (s.projectId === projectId) this.kill(s.id);
  }

  /**
   * Drain any pending fan-out buffer into the (already-up-to-date) scrollback
   * and reset the coalesce timer. Used by `attach()` so that the snapshot a
   * new client receives is complete and no buffered chunk gets re-broadcast
   * to it after attachment.
   */
  flushPending(sessionId: string): void {
    const f = this.fanouts.get(sessionId);
    if (!f) return;
    if (f.timer) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    f.pending = "";
  }

  broadcast(session: Session, frame: object): void {
    const payload = JSON.stringify(frame);
    for (const ws of session.attachments) {
      try {
        (ws as { send: (s: string) => void }).send(payload);
      } catch {
        // attachment died; will be removed by close handler
      }
    }
  }

  private onPtyData(session: Session, data: string): void {
    session.scrollback.append(data);
    const f = this.fanouts.get(session.id);
    if (!f) return;
    f.pending += data;
    if (f.timer) return;
    f.timer = setTimeout(() => {
      const flushed = f.pending;
      f.pending = "";
      f.timer = null;
      if (flushed.length > 0) this.broadcast(session, { type: "output", data: flushed });
    }, this.coalesceMs);
  }

  private onPtyExit(session: Session, code: number | null): void {
    this.broadcast(session, { type: "exit", code });
    this.deps.liveSessions?.markEndedByPty(session.id);
    setTimeout(() => this.dropSession(session), this.exitRetentionMs);
  }

  private dropSession(session: Session): void {
    const f = this.fanouts.get(session.id);
    if (f?.timer) clearTimeout(f.timer);
    this.fanouts.delete(session.id);
    this.sessions.delete(session.id);
    session.scrollback.clear();
    for (const ws of session.attachments) {
      try {
        (ws as { close: (code?: number) => void }).close(1000);
      } catch {
        // ignore
      }
    }
    session.attachments.clear();
  }
}
