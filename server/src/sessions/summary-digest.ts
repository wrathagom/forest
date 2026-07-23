import type { DigestMessageRow } from "./vault";

export type Digest = {
  /** The prompt-ready transcript text. */
  text: string;
  /** uuids actually present in `text` — the whitelist for anchor validation. */
  uuids: Set<string>;
  /** Count of distinct citable messages in `text` — what a later task's
   *  "is this session worth summarizing" decision keys off. */
  includedCount: number;
};

const PER_MESSAGE_MAX = 1200;
const TOTAL_MAX = 60_000;
// The tail favors the ending over the opening: how a session concluded is
// more useful to a summary than how it started, so the tail gets the larger
// share of the budget when both can't fit.
const HEAD_FRACTION = 0.4;
const TOOL_ARG_MAX = 80;

function firstStringArg(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  // Order matters: `path` must come after `pattern` or a Grep/Glob call that
  // supplies both (the common case) would render the directory it searched
  // instead of what it searched for — the one field worth summarizing.
  for (const key of ["command", "file_path", "notebook_path", "pattern", "path", "query", "url", "description", "skill"]) {
    const v = i[key];
    if (typeof v === "string" && v.trim()) {
      const line = v.trim().split("\n")[0]!;
      return line.length > TOOL_ARG_MAX ? line.slice(0, TOOL_ARG_MAX) + "…" : line;
    }
  }
  return "";
}

function resultSize(content: unknown): number {
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  if (content === undefined || content === null) return 0;
  return Buffer.byteLength(JSON.stringify(content), "utf8");
}

/**
 * Pull displayable text out of a stored JSONL line. Never more permissive
 * than the frontend's `parseMessageContent` filter (see
 * `web/src/lib/transcript.ts`), so the model can only ever cite a message
 * that will have a DOM node to scroll to — it may be stricter (e.g. it drops
 * unknown block types that the frontend still renders as a JSON fallback),
 * but it must never treat something as displayable that the frontend
 * wouldn't render. See `tests/digest-frontend-parity.test.ts`. Tool
 * *results* are deliberately reduced to status and size — their bodies are
 * most of the token weight and none of the meaning.
 */
export function displayText(rawLine: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return rawLine.trim();
  }
  if (!parsed || typeof parsed !== "object") return "";
  const content = (parsed as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      const t = b.text.trim();
      if (t) parts.push(t);
    } else if (b.type === "tool_use") {
      const arg = firstStringArg(b.input);
      parts.push(`<tool_use ${String(b.name ?? "tool")}${arg ? " " + arg : ""}>`);
    } else if (b.type === "tool_result") {
      parts.push(`<tool_result ${b.is_error === true ? "error" : "ok"} ${resultSize(b.content)}b>`);
    }
    // thinking / redacted_thinking and unknown blocks are dropped
  }
  return parts.join("\n").trim();
}

export function renderDigest(messages: DigestMessageRow[]): Digest {
  const lines: Array<{ uuid: string; line: string }> = [];
  for (const m of messages) {
    if (!m.uuid) continue; // unanchorable
    const text = displayText(m.content);
    if (!text) continue;
    const clipped = text.length > PER_MESSAGE_MAX ? text.slice(0, PER_MESSAGE_MAX) + "…" : text;
    lines.push({ uuid: m.uuid, line: `[${m.uuid}] ${m.role}: ${clipped}` });
  }

  const total = lines.reduce((n, l) => n + l.line.length + 1, 0);
  let kept = lines;

  if (total > TOTAL_MAX) {
    // Two passes: fill `head` from the start up to `headBudget`, then
    // backfill `tail` from the end within what's left of the total budget,
    // stopping once it reaches `head` — nothing `head` already claimed is
    // re-included, so the two never overlap.
    const headBudget = Math.floor(TOTAL_MAX * HEAD_FRACTION);
    const head: typeof lines = [];
    let used = 0;
    for (const l of lines) {
      if (used + l.line.length + 1 > headBudget) break;
      head.push(l);
      used += l.line.length + 1;
    }
    const tail: typeof lines = [];
    used = 0;
    for (let i = lines.length - 1; i >= head.length; i--) {
      const l = lines[i]!;
      if (used + l.line.length + 1 > TOTAL_MAX - headBudget) break;
      tail.unshift(l);
      used += l.line.length + 1;
    }
    const omitted = lines.length - head.length - tail.length;
    kept = omitted > 0
      ? [...head, { uuid: "", line: `… ${omitted} messages omitted …` }, ...tail]
      : [...head, ...tail];
  }

  const uuids = new Set(kept.map((l) => l.uuid).filter((u) => u.length > 0));
  return { text: kept.map((l) => l.line).join("\n"), uuids, includedCount: uuids.size };
}

export function buildPrompt(digest: string): string {
  return [
    "Summarize this Claude Code session transcript digest.",
    "",
    "Return ONLY JSON matching this shape, with no prose around it:",
    '{"summary":"2-4 sentences of plain past-tense prose","moments":[{"uuid":"<copied verbatim from a [bracket] in the digest>","label":"short phrase, max 60 chars"}]}',
    "",
    "Give 3-6 moments covering the turning points: what was asked, key decisions,",
    "corrections, and the outcome. Order them as they appear in the digest.",
    "Every uuid MUST be copied exactly from a [bracket] in the digest. Never invent one.",
    "",
    "--- DIGEST ---",
    digest,
  ].join("\n");
}
