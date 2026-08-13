import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifyCwd } from "./scanner";
import type { CodexScanEntry, LiveState } from "./live";

export type ParsedCodexRollout =
  | {
      ok: true;
      sessionId: string;
      cwd: string;
      startedAt: number;
      lastEventAt: number;
      lastUserMsg: string | null;
    }
  | { ok: false };

/** Pull the display text out of a Codex message `content` (array of parts, or a
 *  bare string in older formats). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
      parts.push((p as { text: string }).text);
    }
  }
  return parts.join("");
}

/** Parse a Codex rollout JSONL. Skips blank/malformed lines. Returns ok:false
 *  when there is no `session_meta` (the file is not a usable rollout). */
export function parseCodexRollout(text: string): ParsedCodexRollout {
  let sessionId: string | null = null;
  let cwd = "";
  let startedAt = 0;
  let lastEventAt = 0;
  let lastUserMsg: string | null = null;

  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof obj?.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
    if (!Number.isNaN(ts) && ts > lastEventAt) lastEventAt = ts;

    const payload = obj?.payload;
    if (obj?.type === "session_meta" && payload?.session_id) {
      sessionId = String(payload.session_id);
      cwd = typeof payload.cwd === "string" ? payload.cwd : "";
      const metaTs = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : ts;
      startedAt = Number.isNaN(metaTs) ? 0 : metaTs;
      continue;
    }
    if (payload?.type === "message" && payload?.role === "user" && lastUserMsg === null) {
      const t = messageText(payload.content).trim();
      if (t.length > 0 && !t.startsWith("<environment_context>")) lastUserMsg = t;
    }
  }

  if (!sessionId) return { ok: false };
  if (lastEventAt === 0) lastEventAt = startedAt;
  return { ok: true, sessionId, cwd, startedAt, lastEventAt, lastUserMsg };
}

export type CodexTerminal = { ptySessionId: string; cwd: string; startedAt: number };

export type BuildCodexCtx = {
  now: number;
  projects: Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
  liveCodexTerminals: CodexTerminal[];
};

const WORKING_WINDOW_MS = 30_000; // fresh write ⇒ actively working
const ACTIVE_WINDOW_MS = 60_000; // recent but no terminal ⇒ still live, inert

export function buildCodexEntry(
  parsed: Extract<ParsedCodexRollout, { ok: true }>,
  ctx: BuildCodexCtx,
): CodexScanEntry {
  const { projectId, worktreeLabel } = classifyCwd(parsed.cwd, ctx.projects);
  const match = ctx.liveCodexTerminals
    .filter((t) => t.cwd === parsed.cwd)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  const idle = ctx.now - parsed.lastEventAt;
  let state: LiveState;
  let endedAt: number | null;
  if (match) {
    state = idle < WORKING_WINDOW_MS ? "working" : "waiting";
    endedAt = null;
  } else if (idle < ACTIVE_WINDOW_MS) {
    state = "waiting";
    endedAt = null;
  } else {
    state = "stale";
    endedAt = parsed.lastEventAt;
  }

  return {
    agentSessionId: parsed.sessionId,
    cwd: parsed.cwd,
    projectId,
    projectName: projectId ? ctx.projectName(projectId) : null,
    worktreeLabel,
    ptySessionId: match?.ptySessionId ?? null,
    state,
    endedAt,
    startedAt: parsed.startedAt,
    lastEventAt: parsed.lastEventAt,
    lastUserMsg: parsed.lastUserMsg,
  };
}

export type ScanCodexDeps = {
  sessionsRoot: string;
  now: number;
  liveWindowMs: number;
  projects: Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
  liveCodexTerminals: CodexTerminal[];
  apply: (e: CodexScanEntry) => void;
};

/** Recursively collect *.jsonl paths under `dir`. */
function collectJsonl(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) collectJsonl(full, out);
    else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
  }
}

export function scanCodexSessions(deps: ScanCodexDeps): void {
  if (!existsSync(deps.sessionsRoot)) return;
  const files: string[] = [];
  collectJsonl(deps.sessionsRoot, files);
  const cutoff = deps.now - deps.liveWindowMs;
  for (const full of files) {
    let mtime: number;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (mtime < cutoff) continue; // a live rollout stays fresh; old ones age out
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const parsed = parseCodexRollout(text);
    if (!parsed.ok) continue;
    deps.apply(
      buildCodexEntry(parsed, {
        now: deps.now,
        projects: deps.projects,
        projectName: deps.projectName,
        liveCodexTerminals: deps.liveCodexTerminals,
      }),
    );
  }
}
