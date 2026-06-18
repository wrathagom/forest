export type LiveState = "working" | "waiting" | "stale";

export type LiveEntry = {
  agentSessionId: string;
  parentSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  cwd: string;
  worktreeLabel: string | null;
  branch: string | null;
  profile: string | null;
  ptySessionId: string | null;
  state: LiveState;
  endedAt: number | null;
  startedAt: number;
  lastEventAt: number;
  lastUserMsg: string | null;
  launchedVia: "mobile" | null;
};

export type LiveSessionRow = LiveEntry;

/** What the ingest route hands us after enriching a hook event from the vault. */
export type LiveUpdate = {
  agentSessionId: string;
  /** lowercased hook event name: sessionstart | userpromptsubmit | stop | notification | sessionend | precompact | … */
  event: string;
  cwd: string;
  parentSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  worktreeLabel: string | null;
  branch: string | null;
  profile: string | null;
  /** the prompt text for userpromptsubmit, else a fallback (vault first_user_msg) — may be null */
  lastUserMsg: string | null;
  /** value of the X-Forest-Pty header, or null for sessions not launched by Forest */
  ptySessionId: string | null;
  at: number;
  /** how the session was launched: "mobile" for headless runs, null for PTY-backed and external sessions */
  launchedVia?: "mobile" | null;
};

export type LiveDeps = {
  endedRetentionMs?: number; // default 30 min
  idleAfterMs?: number; // default 15 min
  dismissedRetentionMs?: number; // default 12 h
  /** persists "done" dismissals so they survive a server restart; in-memory only when omitted */
  dismissals?: import("../store/dismissals").DismissalStore;
  /** notified after any live-state mutation; carries the triggering hook event when there is one */
  onChange?: (ctx: { event?: string; agentSessionId?: string }) => void;
};

const DEFAULT_ENDED_RETENTION_MS = 30 * 60_000;
const DEFAULT_IDLE_AFTER_MS = 15 * 60_000;
const DEFAULT_DISMISSED_RETENTION_MS = 12 * 3600_000;

function stateForEvent(event: string, prev: LiveState): LiveState {
  switch (event) {
    case "userpromptsubmit":
    case "pretooluse":
    case "posttooluse":
      // a tool call starting or finishing means the agent is churning, not blocked
      // on you — clears a stale `waiting` left over from a Notification. PostToolUse
      // notably fires the moment you answer an AskUserQuestion, so the chip leaves
      // `waiting` as soon as the agent resumes rather than waiting for the next event.
      return "working";
    case "stop":
    case "notification":
    case "sessionstart":
      return "waiting";
    case "sessionend":
      return "stale";
    default:
      return prev; // precompact, unknown — no change
  }
}

export class LiveAgentSessions {
  private readonly entries = new Map<string, LiveEntry>();
  // sessions the user explicitly marked "done" → sid : when dismissed
  private readonly dismissed = new Map<string, number>();
  private readonly endedRetentionMs: number;
  private readonly idleAfterMs: number;
  private readonly dismissedRetentionMs: number;
  private readonly dismissalStore: LiveDeps["dismissals"];
  private readonly onChange: LiveDeps["onChange"];

  constructor(deps: LiveDeps = {}) {
    this.endedRetentionMs = deps.endedRetentionMs ?? DEFAULT_ENDED_RETENTION_MS;
    this.idleAfterMs = deps.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
    this.dismissedRetentionMs = deps.dismissedRetentionMs ?? DEFAULT_DISMISSED_RETENTION_MS;
    this.dismissalStore = deps.dismissals;
    this.onChange = deps.onChange;
    for (const [sid, at] of this.dismissalStore?.load() ?? []) this.dismissed.set(sid, at);
  }

  private notify(ctx: { event?: string; agentSessionId?: string }): void {
    try {
      this.onChange?.(ctx);
    } catch {
      /* a misbehaving observer must never break live-state mutation / hook ingest */
    }
  }

  /** User said "I'm done with this one" — drop it from the actionable lists. */
  dismiss(agentSessionId: string, at: number = Date.now()): void {
    this.dismissed.set(agentSessionId, at);
    this.dismissalStore?.put(agentSessionId, at);
    const entry = this.entries.get(agentSessionId);
    if (entry) this.entries.set(agentSessionId, { ...entry, state: "stale", endedAt: entry.endedAt ?? at });
    this.notify({ event: "dismiss", agentSessionId });
  }

  private undismiss(agentSessionId: string): void {
    if (this.dismissed.delete(agentSessionId)) this.dismissalStore?.delete(agentSessionId);
  }

  isDismissed(agentSessionId: string): boolean {
    return this.dismissed.has(agentSessionId);
  }

  applyHookEvent(u: LiveUpdate): void {
    const prev = this.entries.get(u.agentSessionId);
    // A SessionEnd for a session we never saw start is not a live session — it's
    // the death rattle of a failed `claude --resume <bad-id>` (which still fires
    // SessionEnd on its way out). Seeding an entry here would put a phantom closed
    // chip in the session bar that resumes-and-fails-again when clicked, breeding
    // more phantoms. Drop it: there is nothing live to mark ended.
    if (!prev && u.event === "sessionend") return;
    // Any non-sessionend event is proof the session is alive right now — clear
    // a stale endedAt left over from a previous PTY exit / sessionend so prune()
    // doesn't silently drop an actively-running session 30 min after that old
    // timestamp (notably hits resume flows, where the old PTY died but the new
    // PTY's SessionStart didn't reset endedAt).
    let endedAt: number | null = u.event === "sessionend" ? u.at : null;
    if (u.event === "userpromptsubmit") this.undismiss(u.agentSessionId);
    const entry: LiveEntry = {
      agentSessionId: u.agentSessionId,
      parentSessionId: u.parentSessionId ?? prev?.parentSessionId ?? null,
      projectId: u.projectId ?? prev?.projectId ?? null,
      projectName: u.projectName ?? prev?.projectName ?? null,
      cwd: u.cwd || prev?.cwd || "",  // || not ?? — empty string is not a valid cwd
      worktreeLabel: u.worktreeLabel ?? prev?.worktreeLabel ?? null,
      branch: u.branch ?? prev?.branch ?? null,
      profile: u.profile ?? prev?.profile ?? null,
      ptySessionId: u.ptySessionId ?? prev?.ptySessionId ?? null,
      state: stateForEvent(u.event, prev?.state ?? "waiting"),
      endedAt,
      startedAt: prev?.startedAt ?? u.at,
      lastEventAt: u.at,
      lastUserMsg: u.lastUserMsg ?? prev?.lastUserMsg ?? null,
      launchedVia: u.launchedVia ?? prev?.launchedVia ?? null,
    };
    this.entries.set(u.agentSessionId, entry);
    this.notify({ event: u.event, agentSessionId: u.agentSessionId });
  }

  markEndedByPty(ptySessionId: string, at: number = Date.now()): void {
    for (const entry of this.entries.values()) {
      if (entry.ptySessionId === ptySessionId && entry.endedAt === null) {
        this.entries.set(entry.agentSessionId, { ...entry, state: "stale", endedAt: at });
        this.notify({ event: "sessionend", agentSessionId: entry.agentSessionId });
      }
    }
  }

  prune(now: number = Date.now()): void {
    for (const [sid, at] of this.dismissed) {
      if (now - at > this.dismissedRetentionMs) this.undismiss(sid);
    }
    for (const [sid, entry] of this.entries) {
      if (entry.endedAt !== null && now - entry.endedAt > this.endedRetentionMs) {
        this.entries.delete(sid);
        continue;
      }
      // idle too long: mark stale but keep endedAt = null — these persist until a real
      // SessionEnd / pty exit; list() caps at 10 by recency so they age out of view anyway.
      if (entry.state !== "stale" && now - entry.lastEventAt > this.idleAfterMs) {
        this.entries.set(sid, { ...entry, state: "stale" });
      }
    }
  }

  getEntry(agentSessionId: string): LiveEntry | undefined {
    return this.entries.get(agentSessionId);
  }

  noteHeadlessRunStarted(a: {
    agentSessionId: string;
    projectId: string | null;
    projectName: string | null;
    cwd: string;
    worktreeLabel: string | null;
    branch: string | null;
    prompt: string;
    at?: number;
  }): void {
    const at = a.at ?? Date.now();
    const prev = this.entries.get(a.agentSessionId);
    this.entries.set(a.agentSessionId, {
      agentSessionId: a.agentSessionId,
      parentSessionId: prev?.parentSessionId ?? null,
      projectId: a.projectId,
      projectName: a.projectName,
      cwd: a.cwd || prev?.cwd || "",
      worktreeLabel: a.worktreeLabel,
      branch: a.branch,
      ptySessionId: null,
      state: "working",
      endedAt: null,
      startedAt: prev?.startedAt ?? at,
      lastEventAt: at,
      lastUserMsg: a.prompt,
      launchedVia: "mobile",
    });
    this.notify({ event: "sessionstart", agentSessionId: a.agentSessionId });
  }

  list(limit = 10): LiveEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.parentSessionId === null)
      .sort((a, b) => b.lastEventAt - a.lastEventAt)
      .slice(0, limit);
  }
}
