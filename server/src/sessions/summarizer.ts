import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readdirSync, rmSync, existsSync } from "node:fs";
import type { Vault } from "./vault";
import type { ClaudeConfigDir } from "./config-dirs";
import { renderDigest, buildPrompt } from "./summary-digest";
import { parseSummaryOutput, resultTextFromEnvelope, type Moment } from "./summary-parse";

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
  maxConcurrent?: number;
  log?: Logger;
};

/** Below this, a summary costs more than it is worth (~$0.04 and ~18s a run). */
const MIN_MESSAGES = 4;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_CONCURRENT = 2;

export class SessionSummarizer {
  private readonly spawnFn: SummarizerSpawnFn;
  private readonly claudeBin: string;
  private readonly model: string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly log: Logger;

  private readonly running = new Map<string, SummarizerProc>();
  /** Sessions admitted for a run — queued OR spawned. This, not `running`, is
   *  the dedupe key: a session waiting for a slot has no child process yet, and
   *  keying off `running` would let a second request enqueue it a second time
   *  and pay for the same summary twice. */
  private readonly claimed = new Set<string>();
  private readonly queue: Array<{ sessionId: string; run: () => void }> = [];
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
    this.maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.log = deps.log ?? (() => {});
  }

  /** Where summarizer runs execute — outside any scanned project, so their own
   *  transcripts classify with a null project_id and stay out of project lists. */
  summarizerCwd(): string {
    return join(this.deps.dataDir, "summarizer");
  }

  status(sessionId: string): SummaryStatus {
    if (this.claimed.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    const row = this.deps.vault.getSummary(sessionId);
    if (!row) {
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

  async request(sessionId: string, opts: { force?: boolean } = {}): Promise<SummaryStatus> {
    if (this.claimed.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    const existing = this.deps.vault.getSummary(sessionId);
    if (existing && !opts.force) return this.status(sessionId);

    const messages = this.deps.vault.messagesForDigest(sessionId);
    const digest = renderDigest(messages);
    if (digest.includedCount < MIN_MESSAGES) return { status: "skipped" };

    const configDirs = this.deps.claudeConfigDirs();
    const configDir =
      configDirs.find((c) => c.profile === session.profile)?.path ?? configDirs[0]?.path;
    const messageCount = session.message_count;
    if (!configDir) {
      return this.store(sessionId, session.last_activity, messageCount, {
        ok: false, reason: "no claude config dir available",
      });
    }

    // Claim here — the run is definitely happening, and from this point a
    // concurrent request for the same session must see it as pending.
    this.claimed.add(sessionId);
    await this.run(sessionId, {
      prompt: buildPrompt(digest.text),
      uuids: digest.uuids,
      configDir,
      lastActivity: session.last_activity,
      messageCount,
    });
    return this.status(sessionId);
  }

  shutdown(): void {
    this.shuttingDown = true;
    for (const proc of this.running.values()) {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
    this.running.clear();
    // Release rather than discard: a discarded resolver leaves its `request()`
    // promise permanently unsettled. Each waiter resumes, sees `shuttingDown`,
    // and returns without spawning.
    for (const waiter of this.queue.splice(0, this.queue.length)) waiter.run();
  }

  private async run(
    sessionId: string,
    args: { prompt: string; uuids: Set<string>; configDir: string; lastActivity: number; messageCount: number },
  ): Promise<void> {
    if (this.shuttingDown) {
      this.claimed.delete(sessionId);
      return;
    }
    if (this.activeSlots >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push({ sessionId, run: resolve }));
      // `drain()` already took the slot on our behalf — do not take it again.
      // A shutdown release grants no slot, so bail before any bookkeeping.
      if (this.shuttingDown) {
        this.claimed.delete(sessionId);
        return;
      }
    } else {
      this.activeSlots++;
    }

    const runId = randomUUID();
    let proc: SummarizerProc;
    try {
      proc = this.spawnFn({
        cmd: [
          this.claudeBin, "-p", args.prompt,
          "--session-id", runId,
          "--model", this.model,
          "--output-format", "json",
          "--allowed-tools", "",
        ],
        cwd: this.summarizerCwd(),
        env: {
          ...(process.env as Record<string, string>),
          CLAUDE_CONFIG_DIR: args.configDir,
          FOREST_INTERNAL: "1",
        },
      });
    } catch (err) {
      this.store(sessionId, args.lastActivity, args.messageCount, {
        ok: false, reason: `failed to start claude: ${(err as Error).message}`,
      });
      this.releaseSlot(sessionId);
      return;
    }

    this.running.set(sessionId, proc);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }, this.timeoutMs);

    try {
      const { code, stdout, stderr } = await proc.exited;
      if (timedOut) {
        this.store(sessionId, args.lastActivity, args.messageCount, {
          ok: false, reason: `summarizer timed out after ${Math.round(this.timeoutMs / 1000)}s`,
        });
      } else if (code !== 0) {
        this.store(sessionId, args.lastActivity, args.messageCount, {
          ok: false, reason: stderr.trim().slice(0, 500) || `claude exited ${code}`,
        });
      } else {
        const envelope = resultTextFromEnvelope(stdout);
        this.store(
          sessionId, args.lastActivity, args.messageCount,
          envelope.ok ? parseSummaryOutput(envelope.text, args.uuids) : envelope,
        );
      }
    } catch (err) {
      this.store(sessionId, args.lastActivity, args.messageCount, {
        ok: false, reason: (err as Error).message,
      });
    } finally {
      clearTimeout(timer);
      this.running.delete(sessionId);
      this.cleanupTranscript(args.configDir, runId);
      this.releaseSlot(sessionId);
    }
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
      next.run();
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
      this.log("warn", "summarizer: transcript cleanup failed", { error: (err as Error).message });
    }
  }

  private store(
    sessionId: string,
    lastActivity: number,
    messageCount: number,
    result: { ok: true; summary: string; moments: Moment[] } | { ok: false; reason: string },
  ): SummaryStatus {
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
    if (!result.ok) this.log("warn", "summarizer failed", { sessionId, reason: result.reason });
    return this.status(sessionId);
  }
}
