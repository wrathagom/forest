import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readdirSync, rmSync, existsSync } from "node:fs";
import type { Vault } from "./vault";
import type { ClaudeConfigDir } from "./config-dirs";
import { renderDigest, buildPrompt } from "./summary-digest";
import { parseSummaryOutput, resultTextFromEnvelope, type Moment, type SummaryParse } from "./summary-parse";

export type SummarizerProc = {
  exited: Promise<{ code: number; stdout: string; stderr: string }>;
  kill(signal?: string): void;
};

export type SummarizerSpawnFn = (opts: {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}) => SummarizerProc;

export const bunSummarizerSpawn: SummarizerSpawnFn = ({ cmd, cwd, env }) => {
  const proc = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return {
    exited: (async () => {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    })(),
    kill: (sig?: string) => proc.kill(sig as never),
  };
};

export type SummaryStatus = {
  status: "ready" | "pending" | "error" | "absent" | "skipped";
  summary?: string;
  moments?: Moment[];
  model?: string | null;
  generatedAt?: number;
  stale?: boolean;
  error?: string | null;
};

type Logger = (level: string, msg: string, meta?: Record<string, unknown>) => void;

export type SummarizerDeps = {
  vault: Vault;
  dataDir: string;
  claudeConfigDirs: () => ClaudeConfigDir[];
  spawn?: SummarizerSpawnFn;
  claudeBin?: string;
  model?: string;
  now?: () => number;
  timeoutMs?: number;
  /** Extra time a child gets to die after SIGTERM before we stop waiting on it. */
  killGraceMs?: number;
  maxConcurrent?: number;
  maxQueue?: number;
  log?: Logger;
};

/** Below this, a summary costs more than it is worth (~$0.04 and ~18s a run). */
const MIN_MESSAGES = 4;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_KILL_GRACE_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 2;
/**
 * Backlog cap. `request()` is fire-and-forget, so nothing upstream throttles
 * admissions any more and each one costs ~$0.04 and ~18s. At the default
 * concurrency of 2, 16 queued runs is ~2.5 minutes of backlog — already past
 * the web client's ~2 minute polling window (`MAX_POLLS * POLL_MS`), so a run
 * admitted beyond it would finish after the only viewer stopped watching.
 */
const DEFAULT_MAX_QUEUE = 16;
/** How much raw stdout to log when a clean exit produced unusable output. */
const STDOUT_LOG_CHARS = 500;

type RunOutcome =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "failed"; error: string }
  | { kind: "abandoned" };

/**
 * Summarizes a historical Claude Code session by shelling out to `claude -p`.
 *
 * INVARIANTS (all three must hold together; breaking any one costs real money
 * or leaks a slot):
 *
 *  1. `claimed` ⊇ the set of sessions with a live `run()` frame. A session is
 *     added exactly once, at admission in `request()`, and removed on exactly
 *     one of the terminal paths (`releaseSlot`, or the two shutdown bails in
 *     `run()`). While it is present, `status()` and `request()` both report
 *     `pending`, which is what stops the same summary being paid for twice.
 *  2. `activeSlots` equals the number of concurrency slots currently held.
 *     It is NOT derivable from `running.size`: a dequeued waiter holds its slot
 *     from the moment `drain()` hands it over until its continuation actually
 *     spawns, a microtask later.
 *  3. Each admitted run increments `activeSlots` exactly once, by exactly one
 *     of `run()` (slot free on arrival) or `drain()` (slot handed to a waiter),
 *     and decrements it exactly once via `releaseSlot()` — or, if shutdown
 *     races the handover, via the `granted` bail in `run()`.
 *
 * The check-then-claim window in `request()` is the load-bearing detail: the
 * `claimed` guard and the `claimed.add()` are separated by several calls, and
 * the only reason the same-session double-spend fix holds is that every one of
 * them is synchronous. See the comment in `request()`.
 */
export class SessionSummarizer {
  private readonly spawnFn: SummarizerSpawnFn;
  private readonly claudeBin: string;
  private readonly model: string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly log: Logger;

  private readonly running = new Map<string, SummarizerProc>();
  /** Sessions admitted for a run — queued OR spawned. This, not `running`, is
   *  the dedupe key: a session waiting for a slot has no child process yet, and
   *  keying off `running` would let a second request enqueue it a second time
   *  and pay for the same summary twice. */
  private readonly claimed = new Set<string>();
  /** Failures that happened BEFORE a child was spawned, and therefore cost
   *  nothing. Deliberately in memory instead of the summaries table: their
   *  causes (PATH not populated at boot, config dirs not discovered yet) are
   *  transient, and a persisted row would suppress every future attempt until
   *  the user found the Retry button. Cleared when the session is next
   *  admitted. */
  private readonly transientErrors = new Map<string, { reason: string; at: number }>();
  private readonly queue: Array<{ sessionId: string; resume: (granted: boolean) => void }> = [];
  /** In-flight `run()` promises — see `idle()`. */
  private readonly inFlight = new Set<Promise<void>>();
  /** Slots held right now. Counted rather than read off `running.size` because a
   *  dequeued waiter doesn't spawn until its continuation resumes a microtask
   *  later — `drain()` reading `running.size` would see a stale count and
   *  release the whole queue on the first completion. */
  private activeSlots = 0;
  private shuttingDown = false;

  constructor(private readonly deps: SummarizerDeps) {
    this.spawnFn = deps.spawn ?? bunSummarizerSpawn;
    this.claudeBin = deps.claudeBin ?? "claude";
    this.model = deps.model ?? DEFAULT_MODEL;
    this.now = deps.now ?? (() => Date.now());
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueue = deps.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.log = deps.log ?? (() => {});
  }

  /** Where summarizer runs execute — outside any scanned project, so their own
   *  transcripts classify with a null project_id and stay out of project lists. */
  summarizerCwd(): string {
    return join(this.deps.dataDir, "summarizer");
  }

  /** Resolves once nothing is running or queued. `request()` is
   *  fire-and-forget, so this is how a caller (shutdown paths, tests) waits for
   *  the work it kicked off. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  status(sessionId: string): SummaryStatus {
    if (this.claimed.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    // Reported ahead of any stored row: after an explicit regenerate that never
    // reached a child process, showing the previous summary would hide the
    // failure. The row (if any) reappears as soon as a retry succeeds.
    const transient = this.transientErrors.get(sessionId);
    if (transient) return { status: "error", error: transient.reason, generatedAt: transient.at };

    const row = this.deps.vault.getSummary(sessionId);
    if (!row) {
      // Deliberately a different measure from `request()`'s
      // `digest.includedCount < MIN_MESSAGES`: this is the cheap stored count of
      // all messages, that one counts messages that actually render as citable
      // digest lines. GET can therefore answer `absent` where POST answers
      // `skipped` — benign, and POST's answer is the one that decides spending.
      return session.message_count < MIN_MESSAGES ? { status: "skipped" } : { status: "absent" };
    }

    if (row.status === "error") {
      return { status: "error", error: row.error, generatedAt: row.generated_at };
    }

    const stale =
      row.source_last_activity < session.last_activity ||
      row.source_message_count < session.message_count;

    let moments: Moment[] = [];
    try {
      moments = JSON.parse(row.moments) as Moment[];
    } catch {
      moments = [];
    }

    return {
      status: "ready",
      summary: row.summary ?? "",
      moments,
      model: row.model,
      generatedAt: row.generated_at,
      stale,
    };
  }

  /**
   * Admit a summary run. Returns as soon as the decision is made — it never
   * waits for the run, which takes ~18s (and up to `timeoutMs`, or twice that
   * when queued behind another). The HTTP caller polls `status()` for the
   * result; `pending` is the contract the web client already implements.
   */
  async request(sessionId: string, opts: { force?: boolean } = {}): Promise<SummaryStatus> {
    // ---- check-then-claim window: NO `await` from here to `claimed.add()` ----
    // Every call below (`getSession`, `getSummary`, `messagesForDigest`,
    // `renderDigest`, `claudeConfigDirs`) is synchronous, so this whole stretch
    // is one uninterruptible turn and a concurrent request cannot observe the
    // gap between the guard and the claim. Introducing a single `await` in here
    // reopens the same-session double-spend: two POSTs for one session would
    // both pass the guard and both pay ~$0.04. If something in here ever needs
    // to become async, move the claim up to immediately after the guard.
    if (this.claimed.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    const existing = this.deps.vault.getSummary(sessionId);
    if (existing && !opts.force) return this.status(sessionId);

    const messages = this.deps.vault.messagesForDigest(sessionId);
    const digest = renderDigest(messages);
    if (digest.includedCount < MIN_MESSAGES) return { status: "skipped" };

    const configDirs = this.deps.claudeConfigDirs();
    const profile = session.profile ?? null;
    const configDir = configDirs.find((c) => c.profile === profile)?.path ?? configDirs[0]?.path;
    if (!configDir) {
      // Pre-spawn and free — not cached. See `transientErrors`.
      return this.failTransient(sessionId, "no claude config dir available", { profile });
    }

    // The backlog is bounded because admission no longer blocks: without this,
    // a page that POSTs on every view could enqueue unbounded paid work.
    // `run()` pushes onto `queue` synchronously, so this length is current.
    if (this.activeSlots >= this.maxConcurrent && this.queue.length >= this.maxQueue) {
      this.log("warn", "summarizer: queue full, request rejected", {
        sessionId, queued: this.queue.length, maxQueue: this.maxQueue,
      });
      return {
        status: "error",
        error: `summarizer is busy (${this.queue.length} summaries queued) — try again shortly`,
      };
    }

    this.transientErrors.delete(sessionId); // a retry supersedes the last attempt

    // Claim here — the run is definitely happening, and from this point a
    // concurrent request for the same session must see it as pending.
    this.claimed.add(sessionId);
    // ---- end of the no-await window ----

    const started = this.run(sessionId, {
      prompt: buildPrompt(digest.text),
      uuids: digest.uuids,
      configDir,
      profile,
      lastActivity: session.last_activity,
      messageCount: session.message_count,
    }).catch((err) => {
      // `run()` is not supposed to reject; if it does, the claim would leak.
      this.claimed.delete(sessionId);
      this.log("error", "summarizer run threw", { sessionId, error: (err as Error).message });
    });
    const tracked: Promise<void> = started.finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);

    return { status: "pending" };
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.log("info", "summarizer shutdown", { running: this.running.size, queued: this.queue.length });
    for (const proc of this.running.values()) {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
    this.running.clear();
    // Release rather than discard: a discarded resolver leaves its `run()`
    // promise permanently unsettled. Each waiter resumes, sees `shuttingDown`,
    // and returns without spawning. `false` = no slot was handed over.
    for (const waiter of this.queue.splice(0, this.queue.length)) waiter.resume(false);
  }

  private async run(
    sessionId: string,
    args: {
      prompt: string;
      uuids: Set<string>;
      configDir: string;
      profile: string | null;
      lastActivity: number;
      messageCount: number;
    },
  ): Promise<void> {
    if (this.shuttingDown) {
      this.claimed.delete(sessionId);
      return;
    }
    if (this.activeSlots >= this.maxConcurrent) {
      this.log("info", "summarizer queued", { sessionId, depth: this.queue.length + 1 });
      const granted = await new Promise<boolean>((resolve) =>
        this.queue.push({ sessionId, resume: resolve }),
      );
      // `drain()` already took the slot on our behalf — do not take it again.
      if (this.shuttingDown) {
        // Give back only what we were actually given: `drain()` increments
        // before resuming a waiter, `shutdown()` resumes without incrementing.
        // Bailing unconditionally would drift `activeSlots` (invariant 2).
        if (granted) this.activeSlots = Math.max(0, this.activeSlots - 1);
        this.claimed.delete(sessionId);
        return;
      }
    } else {
      this.activeSlots++;
    }

    const runId = randomUUID();
    const startedAt = Date.now();
    const logMeta = {
      sessionId, runId, model: this.model, configDir: args.configDir, profile: args.profile,
    };
    this.log("info", "summarizer run started", {
      ...logMeta, promptBytes: Buffer.byteLength(args.prompt, "utf8"),
    });

    let proc: SummarizerProc;
    try {
      proc = this.spawnFn({
        cmd: [
          this.claudeBin, "-p", args.prompt,
          "--session-id", runId,
          "--model", this.model,
          "--output-format", "json",
          "--allowed-tools", "",
          // Suppresses the user's MCP servers (none are configured for us, and
          // `--strict-mcp-config` means only those count), which would otherwise
          // all be launched for a one-shot summary.
          //
          // NOTE what this does NOT suppress: CLAUDE_CONFIG_DIR below points at
          // the user's real profile dir, so their global CLAUDE.md is still
          // injected (it can change output format and inflate token cost) and
          // their own hooks still fire — FOREST_INTERNAL only guards Forest's
          // own shim. The real dir is unavoidable: credentials live in keychain
          // entries hashed per config dir, so a scratch dir cannot authenticate.
          "--strict-mcp-config",
        ],
        cwd: this.summarizerCwd(),
        env: {
          ...(process.env as Record<string, string>),
          CLAUDE_CONFIG_DIR: args.configDir,
          FOREST_INTERNAL: "1",
        },
      });
    } catch (err) {
      // Pre-spawn and free — not cached. See `transientErrors`.
      this.failTransient(sessionId, `failed to start claude: ${(err as Error).message}`, logMeta);
      this.releaseSlot(sessionId);
      return;
    }

    this.running.set(sessionId, proc);
    let timedOut = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const softTimer = setTimeout(() => {
      timedOut = true;
      this.log("warn", "summarizer: timeout, sending SIGTERM", { ...logMeta, timeoutMs: this.timeoutMs });
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }, this.timeoutMs);

    // Never wait on `proc.exited` alone. SIGTERM is advisory, and even a child
    // that does die can leave the wait pending: `bunSummarizerSpawn` reads
    // stdout to EOF, and a grandchild that inherited the pipe holds it open. An
    // unbounded wait would hold this slot and this `claimed` entry until the
    // process restarts — the only way `claimed` can leak permanently.
    const exited: Promise<RunOutcome> = proc.exited.then(
      (r) => ({ kind: "exited", code: r.code, stdout: r.stdout, stderr: r.stderr }),
      (err) => ({ kind: "failed", error: (err as Error).message }),
    );
    const abandoned = new Promise<RunOutcome>((resolve) => {
      hardTimer = setTimeout(() => {
        timedOut = true;
        this.log("warn", "summarizer: hard deadline, abandoning child", {
          ...logMeta, timeoutMs: this.timeoutMs, killGraceMs: this.killGraceMs,
        });
        try { proc.kill("SIGKILL"); } catch { /* already gone */ }
        resolve({ kind: "abandoned" });
      }, this.timeoutMs + this.killGraceMs);
    });

    try {
      const outcome = await Promise.race([exited, abandoned]);
      const result = this.interpret(outcome, timedOut, args.uuids, logMeta);
      this.store(sessionId, args.lastActivity, args.messageCount, result);
      this.log(result.ok ? "info" : "warn", "summarizer run finished", {
        ...logMeta,
        code: outcome.kind === "exited" ? outcome.code : null,
        durationMs: Date.now() - startedAt,
        outcome: result.ok ? "ok" : "error",
        ...(result.ok ? { moments: result.moments.length } : { reason: result.reason }),
      });
    } finally {
      clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      this.running.delete(sessionId);
      this.cleanupTranscript(args.configDir, runId);
      this.releaseSlot(sessionId);
    }
  }

  /** Turn a terminated (or abandoned) run into the row we will persist. Every
   *  branch here is post-spawn, so every branch is cached. */
  private interpret(
    outcome: RunOutcome,
    timedOut: boolean,
    uuids: Set<string>,
    logMeta: Record<string, unknown>,
  ): SummaryParse {
    if (outcome.kind === "abandoned") {
      return {
        ok: false,
        reason: `summarizer timed out after ${Math.round(this.timeoutMs / 1000)}s and did not exit`,
      };
    }
    if (outcome.kind === "failed") return { ok: false, reason: outcome.error };
    if (timedOut) {
      return { ok: false, reason: `summarizer timed out after ${Math.round(this.timeoutMs / 1000)}s` };
    }
    if (outcome.code !== 0) {
      this.log("warn", "summarizer: claude exited non-zero", {
        ...logMeta, code: outcome.code, stderr: outcome.stderr.trim().slice(0, STDOUT_LOG_CHARS),
      });
      return { ok: false, reason: outcome.stderr.trim().slice(0, 500) || `claude exited ${outcome.code}` };
    }

    const envelope = resultTextFromEnvelope(outcome.stdout);
    const result = envelope.ok ? parseSummaryOutput(envelope.text, uuids) : envelope;
    if (!result.ok) {
      // What gets persisted is deliberately user-facing prose ("Claude's reply
      // wasn't valid JSON") and therefore useless for diagnosis. The raw stdout
      // is the only thing that explains it, so log it here and let the friendly
      // string go to the row.
      this.log("warn", "summarizer: unusable stdout on a clean exit", {
        ...logMeta, reason: result.reason, stdout: outcome.stdout.slice(0, STDOUT_LOG_CHARS),
      });
    }
    return result;
  }

  /** Record a failure that happened before any child ran, without persisting
   *  it. Costs nothing to retry, so nothing should stop the next attempt. */
  private failTransient(
    sessionId: string,
    reason: string,
    meta: Record<string, unknown> = {},
  ): SummaryStatus {
    const at = this.now();
    this.transientErrors.set(sessionId, { reason, at });
    this.log("warn", "summarizer failed before spawn (not cached)", { sessionId, reason, ...meta });
    return { status: "error", error: reason, generatedAt: at };
  }

  private releaseSlot(sessionId: string): void {
    this.claimed.delete(sessionId);
    this.activeSlots = Math.max(0, this.activeSlots - 1);
    this.drain();
  }

  private drain(): void {
    while (!this.shuttingDown && this.activeSlots < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) return;
      // Take the slot synchronously, before the waiter's continuation resumes.
      this.activeSlots++;
      this.log("info", "summarizer dequeued", { sessionId: next.sessionId, queued: this.queue.length });
      next.resume(true);
    }
  }

  /** Belt to the scanner's braces: delete the transcript this run wrote. Matched
   *  by filename (the run id) so we never depend on Claude's dir-slug format. */
  private cleanupTranscript(configDir: string, runId: string): void {
    const projects = join(configDir, "projects");
    if (!existsSync(projects)) return;
    try {
      for (const dir of readdirSync(projects, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const candidate = join(projects, dir.name, `${runId}.jsonl`);
        if (existsSync(candidate)) {
          rmSync(candidate, { force: true });
          return;
        }
      }
    } catch (err) {
      this.log("warn", "summarizer: transcript cleanup failed", {
        configDir, runId, error: (err as Error).message,
      });
    }
  }

  private store(
    sessionId: string,
    lastActivity: number,
    messageCount: number,
    result: SummaryParse,
  ): void {
    this.deps.vault.upsertSummary({
      session_id: sessionId,
      summary: result.ok ? result.summary : null,
      moments: JSON.stringify(result.ok ? result.moments : []),
      model: result.ok ? this.model : null,
      status: result.ok ? "ok" : "error",
      error: result.ok ? null : result.reason,
      generated_at: this.now(),
      source_last_activity: lastActivity,
      source_message_count: messageCount,
    });
  }
}
