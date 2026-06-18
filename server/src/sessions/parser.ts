export type SessionPatch = {
  session_id: string;
  agent: "claude";
  cwd: string;
  started_at?: number;
  last_activity: number;
  first_user_msg?: string;
  parent_session_id?: string;
};

export type MessageRecord = {
  session_id: string;
  uuid: string | null;
  role: string;
  content: string;
  timestamp: number;
  model: string | null;
  input_tokens: number | null;
  cache_create_tokens: number | null;
  cache_read_tokens: number | null;
  output_tokens: number | null;
  stop_reason: string | null;
};

export type ToolCallRecord = {
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: string | null;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  result_status: string | null;
  result_size: number | null;
  message_uuid: string | null;
};

export type ToolResultPatch = {
  session_id: string;
  tool_use_id: string;
  finished_at: number;
  result_status: "ok" | "error";
  result_size: number;
};

export type SessionEventRecord = {
  session_id: string;
  kind: "compacted" | "started" | "ended" | "resumed" | "model_changed";
  timestamp: number;
  payload: string | null;
};

export type FtsEntry = { uuid: string | null; text: string };

export type ParseOk = {
  ok: true;
  session: SessionPatch;
  messages: MessageRecord[];
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultPatch[];
  events: SessionEventRecord[];
  fts: FtsEntry[];
  unrecognized: number;
};

export type ParseErr = { ok: false; reason: string };
export type ParseResult = ParseOk | ParseErr;

function tsMs(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function toFtsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === "string") parts.push(b.text);
    if (b.type === "tool_use" && b.input && typeof b.input === "object") {
      for (const [k, v] of Object.entries(b.input as Record<string, unknown>)) {
        parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
      }
    }
    if (b.type === "tool_result") {
      if (typeof b.content === "string") parts.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const c of b.content) {
          if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
            parts.push((c as { text: string }).text);
          }
        }
      }
    }
  }
  return parts.join("\n");
}

export function parseClaudeJsonlLine(line: string): ParseResult {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    return { ok: false, reason: `json parse: ${(err as Error).message}` };
  }

  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const cwd = typeof raw.cwd === "string" ? raw.cwd : null;
  const ts = tsMs(raw.timestamp);
  if (!sessionId || !cwd || ts === null) {
    return { ok: false, reason: "missing sessionId/cwd/timestamp" };
  }

  const type = typeof raw.type === "string" ? raw.type : "";
  const messageObj = (raw.message as Record<string, unknown>) ?? {};
  const role = typeof messageObj.role === "string" ? messageObj.role : type;
  const content = messageObj.content;
  const uuid = typeof raw.uuid === "string" ? raw.uuid : null;

  const usage = (messageObj.usage as Record<string, number>) ?? {};
  const stop = typeof messageObj.stop_reason === "string" ? messageObj.stop_reason : null;
  const model = typeof messageObj.model === "string" ? messageObj.model : null;

  const session: SessionPatch = {
    session_id: sessionId,
    agent: "claude",
    cwd,
    last_activity: ts,
  };
  if (role === "user" && typeof content === "string") {
    session.first_user_msg = content.slice(0, 200);
  } else if (role === "user" && Array.isArray(content)) {
    const firstText = (content as Array<{ text?: string }>).find((b) => b.text)?.text;
    if (firstText) session.first_user_msg = firstText.slice(0, 200);
  }

  const messages: MessageRecord[] = [
    {
      session_id: sessionId,
      uuid,
      role,
      content: line,
      timestamp: ts,
      model,
      input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      cache_create_tokens:
        typeof usage.cache_creation_input_tokens === "number"
          ? usage.cache_creation_input_tokens
          : null,
      cache_read_tokens:
        typeof usage.cache_read_input_tokens === "number"
          ? usage.cache_read_input_tokens
          : null,
      output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
      stop_reason: stop,
    },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const toolResults: ToolResultPatch[] = [];
  const events: SessionEventRecord[] = [];
  let unrecognized = 0;

  if (Array.isArray(content)) {
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "tool_use") {
        toolCalls.push({
          session_id: sessionId,
          tool_use_id: String(block.id ?? ""),
          tool_name: String(block.name ?? "unknown"),
          tool_input: block.input ? JSON.stringify(block.input) : null,
          started_at: ts,
          finished_at: null,
          duration_ms: null,
          result_status: null,
          result_size: null,
          message_uuid: uuid,
        });
      } else if (block.type === "tool_result") {
        const isErr = block.is_error === true;
        const text = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
        toolResults.push({
          session_id: sessionId,
          tool_use_id: String(block.tool_use_id ?? ""),
          finished_at: ts,
          result_status: isErr ? "error" : "ok",
          result_size: text.length,
        });
      } else if (block.type === "text") {
        // already counted in message
      } else {
        unrecognized++;
      }
    }
  }

  if (type === "summary" || type === "compact") {
    events.push({
      session_id: sessionId,
      kind: "compacted",
      timestamp: ts,
      payload: null,
    });
  }

  return {
    ok: true,
    session,
    messages,
    toolCalls,
    toolResults,
    events,
    fts: [{ uuid, text: toFtsText(content) }],
    unrecognized,
  };
}
