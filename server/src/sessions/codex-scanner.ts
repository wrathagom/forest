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
