// Parse a stored agent-session message (a raw Claude Code JSONL line, or
// occasionally a bare string) into a small list of display blocks: prose text,
// tool-call pills, and tool-result pills. Thinking blocks are dropped.

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; summary: string | null }
  | { kind: "tool_result"; isError: boolean; preview: string | null };

const SUMMARY_MAX = 120;
const PREVIEW_MAX = 120;

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// First non-empty line, truncated — for tool-call summaries and result previews.
function firstLine(s: string, max: number): string | null {
  const line = s.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ? truncate(line, max) : null;
}

function toolSummary(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = i[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  let raw: string | null;
  switch (name) {
    case "Bash": raw = pick("command"); break;
    case "Read": case "Edit": case "Write": case "NotebookEdit": raw = pick("file_path", "notebook_path"); break;
    case "Glob": case "Grep": raw = pick("pattern"); break;
    case "Task": raw = pick("description"); break;
    case "WebFetch": raw = pick("url"); break;
    case "WebSearch": raw = pick("query"); break;
    case "Skill": raw = pick("skill"); break;
    default: raw = pick("command", "file_path", "path", "pattern", "query", "url", "description"); break;
  }
  return raw ? firstLine(raw, SUMMARY_MAX) : null;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text"
        ? String((b as { text?: unknown }).text ?? "")
        : typeof b === "string" ? b : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function blockFromPart(part: unknown): TranscriptBlock | null {
  if (!part || typeof part !== "object") {
    const s = String(part ?? "").trim();
    return s ? { kind: "text", text: s } : null;
  }
  const p = part as Record<string, unknown>;
  switch (p.type) {
    case "text": {
      const t = String(p.text ?? "").trim();
      return t ? { kind: "text", text: t } : null;
    }
    case "thinking": case "redacted_thinking":
      return null;
    case "tool_use":
      return { kind: "tool_use", name: String(p.name ?? "tool"), summary: toolSummary(String(p.name ?? ""), p.input) };
    case "tool_result":
      return { kind: "tool_result", isError: p.is_error === true, preview: firstLine(flattenContent(p.content), PREVIEW_MAX) };
    default: {
      // Unknown block — show its JSON so nothing is silently lost.
      const t = JSON.stringify(p).trim();
      return t ? { kind: "text", text: t } : null;
    }
  }
}

function textBlocks(s: string): TranscriptBlock[] {
  const t = s.trim();
  return t ? [{ kind: "text", text: t }] : [];
}

export function parseMessageContent(raw: string): TranscriptBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return textBlocks(raw);
  }
  if (typeof parsed === "string") return textBlocks(parsed);
  if (!parsed || typeof parsed !== "object") return [];

  // Unwrap the JSONL envelope: { type, message: { content }, ... }.
  const obj = parsed as Record<string, unknown>;
  const envelope = obj.message && typeof obj.message === "object" ? (obj.message as Record<string, unknown>) : obj;
  const content = "content" in envelope ? envelope.content : undefined;

  if (typeof content === "string") return textBlocks(content);
  if (Array.isArray(content)) {
    return content.map(blockFromPart).filter((b): b is TranscriptBlock => b !== null);
  }
  // No recognizable content (e.g. a stub/malformed line) — show nothing rather
  // than dumping raw JSON.
  return [];
}

// A message that carries only tool results (the "user" turn Claude Code emits
// after a tool call) — noise in a reading-oriented transcript.
export function isMechanicalMessage(blocks: TranscriptBlock[]): boolean {
  return blocks.length > 0 && blocks.every((b) => b.kind === "tool_result");
}
