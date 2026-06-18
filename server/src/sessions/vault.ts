import type { Database } from "bun:sqlite";
import type {
  SessionPatch,
  MessageRecord,
  ToolCallRecord,
  ToolResultPatch,
  SessionEventRecord,
  FtsEntry,
} from "./parser";

export type IngestSource =
  | "scan"
  | "hook:precompact"
  | "hook:sessionend"
  | "queue"
  | "mobile";

export type SessionRow = {
  session_id: string;
  agent: string;
  project_id: string | null;
  cwd: string;
  worktree_label: string | null;
  branch: string | null;
  cwd_exists: number;
  parent_session_id: string | null;
  started_at: number | null;
  last_activity: number;
  message_count: number;
  first_user_msg: string | null;
  profile: string | null;
  permission_mode: string | null;
  launched_via: string | null;
};

export type TokenBucket = { input: number; output: number; cache: number };
export type TokensOverTimePoint = TokenBucket & { day: string };
export type TokensByProjectRow = TokenBucket & {
  projectId: string | null;
  projectName: string;
  sessions: number;
};

export type SessionListSort = "last_activity" | "started_at" | "tokens" | "message_count" | "project";

export type SessionListRow = SessionRow & {
  project_name: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  snippet?: string;
};

export type SessionDetail = {
  session: SessionRow;
  messages: Array<{
    id: number;
    role: string;
    content: string;
    timestamp: number;
    model: string | null;
    input_tokens: number | null;
    cache_create_tokens: number | null;
    cache_read_tokens: number | null;
    output_tokens: number | null;
    stop_reason: string | null;
  }>;
  toolCalls: Array<{
    id: number;
    tool_use_id: string;
    tool_name: string;
    tool_input: string | null;
    started_at: number;
    finished_at: number | null;
    duration_ms: number | null;
    result_status: string | null;
    result_size: number | null;
  }>;
  events: Array<{ id: number; kind: string; timestamp: number; payload: string | null }>;
};

// Extract the user-visible prompt text from a stored JSONL line (the raw
// envelope kept in agent_messages.content). Returns null when the line carries
// no text content. Mirrors the first_user_msg logic in parser.ts.
function firstUserText(rawLine: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const content = ((parsed as Record<string, unknown>).message as Record<string, unknown>)?.content;
  if (typeof content === "string") return content.length > 0 ? content : null;
  if (Array.isArray(content)) {
    const text = (content as Array<{ text?: unknown }>).find(
      (b) => typeof b?.text === "string" && b.text.length > 0,
    )?.text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

export class Vault {
  constructor(private readonly db: Database) {}

  upsertSession(input: SessionPatch & {
    source: IngestSource;
    project_id?: string | null;
    worktree_label?: string | null;
    branch?: string | null;
    cwd_exists?: boolean;
    parent_session_id?: string | null;
    profile?: string | null;
    permission_mode?: string | null;
    launched_via?: string | null;
  }): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO agent_sessions (
            session_id, agent, project_id, cwd, worktree_label, branch,
            cwd_exists, parent_session_id, started_at, last_activity,
            first_user_msg, profile, imported_at, source, permission_mode, launched_via
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
            project_id     = COALESCE(excluded.project_id, project_id),
            worktree_label = COALESCE(excluded.worktree_label, worktree_label),
            branch         = COALESCE(excluded.branch, branch),
            cwd_exists     = excluded.cwd_exists,
            parent_session_id = COALESCE(excluded.parent_session_id, parent_session_id),
            last_activity  = MAX(last_activity, excluded.last_activity),
            first_user_msg = COALESCE(first_user_msg, excluded.first_user_msg),
            profile        = COALESCE(excluded.profile, profile),
            source         = excluded.source,
            permission_mode = COALESCE(excluded.permission_mode, permission_mode),
            launched_via    = COALESCE(excluded.launched_via, launched_via)`,
      )
      .run(
        input.session_id,
        input.agent,
        input.project_id ?? null,
        input.cwd,
        input.worktree_label ?? null,
        input.branch ?? null,
        (input.cwd_exists ?? true) ? 1 : 0,
        input.parent_session_id ?? null,
        input.started_at ?? null,
        input.last_activity,
        input.first_user_msg ?? null,
        input.profile ?? null,
        now,
        input.source,
        input.permission_mode ?? null,
        input.launched_via ?? null,
      );
  }

  upsertMessages(rows: MessageRecord[], fts: FtsEntry[]): void {
    if (rows.length === 0) return;
    const ftsByUuid = new Map(fts.map((f) => [f.uuid, f.text]));
    const insertMsg = this.db.query<
      { id: number },
      [
        string,                      // session_id
        string | null,               // uuid
        string,                      // role
        string,                      // content
        number,                      // timestamp
        string | null,               // model
        number | null,               // input_tokens
        number | null,               // cache_create_tokens
        number | null,               // cache_read_tokens
        number | null,               // output_tokens
        string | null                // stop_reason
      ]
    >(
      `INSERT INTO agent_messages (
          session_id, uuid, role, content, timestamp, model,
          input_tokens, cache_create_tokens, cache_read_tokens,
          output_tokens, stop_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, uuid) DO NOTHING
       RETURNING id`,
    );
    const insertFts = this.db.query(
      "INSERT INTO agent_messages_fts (session_id, message_id, text) VALUES (?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      for (const m of rows) {
        const inserted = insertMsg.get(
          m.session_id,
          m.uuid,
          m.role,
          m.content,
          m.timestamp,
          m.model,
          m.input_tokens,
          m.cache_create_tokens,
          m.cache_read_tokens,
          m.output_tokens,
          m.stop_reason,
        );
        if (!inserted) continue; // duplicate uuid
        const text = ftsByUuid.get(m.uuid) ?? "";
        if (text.length > 0) insertFts.run(m.session_id, inserted.id, text);
      }
      // bump message_count and last_activity on session
      this.db
        .query(
          `UPDATE agent_sessions
            SET message_count = (
                  SELECT count(*) FROM agent_messages WHERE session_id = ?),
                last_activity = MAX(last_activity, ?)
          WHERE session_id = ?`,
        )
        .run(rows[0]!.session_id, Math.max(...rows.map((r) => r.timestamp)), rows[0]!.session_id);
    });
    tx();
  }

  upsertToolCalls(rows: ToolCallRecord[]): void {
    if (rows.length === 0) return;
    const insert = this.db.query(
      `INSERT INTO agent_tool_calls (
          session_id, tool_use_id, tool_name, tool_input,
          started_at, finished_at, duration_ms, result_status, result_size,
          message_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(session_id, tool_use_id) DO NOTHING`,
    );
    const tx = this.db.transaction(() => {
      for (const tc of rows) {
        insert.run(
          tc.session_id,
          tc.tool_use_id,
          tc.tool_name,
          tc.tool_input,
          tc.started_at,
          tc.finished_at,
          tc.duration_ms,
          tc.result_status,
          tc.result_size,
        );
      }
    });
    tx();
  }

  applyToolResults(rows: ToolResultPatch[]): void {
    if (rows.length === 0) return;
    const update = this.db.query(
      `UPDATE agent_tool_calls
          SET finished_at   = ?,
              duration_ms   = ? - started_at,
              result_status = ?,
              result_size   = ?
        WHERE session_id = ? AND tool_use_id = ?
          AND finished_at IS NULL`,
    );
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        update.run(r.finished_at, r.finished_at, r.result_status, r.result_size, r.session_id, r.tool_use_id);
      }
    });
    tx();
  }

  appendEvents(rows: SessionEventRecord[]): void {
    if (rows.length === 0) return;
    const insert = this.db.query(
      "INSERT INTO agent_session_events (session_id, kind, timestamp, payload) VALUES (?, ?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      for (const e of rows) insert.run(e.session_id, e.kind, e.timestamp, e.payload);
    });
    tx();
  }

  listAll(opts: {
    projectId?: string;            // undefined/"" = all; "none" = unassigned only
    q?: string;
    sort?: SessionListSort;
    dir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): { sessions: SessionListRow[]; total: number } {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const dir = opts.dir === "asc" ? "ASC" : "DESC";
    const sortCol =
      ({
        last_activity: "s.last_activity",
        started_at: "s.started_at",
        tokens: "(COALESCE(t.input,0)+COALESCE(t.output,0)+COALESCE(t.cache,0))",
        message_count: "s.message_count",
        project: "p.name",
      } as Record<string, string>)[opts.sort ?? "last_activity"] ?? "s.last_activity";
    const nullsLast = opts.sort === "project" ? " NULLS LAST" : "";

    const q = opts.q?.trim() || "";
    const where: string[] = [];
    const whereParams: unknown[] = [];
    if (opts.projectId === "none") {
      where.push("s.project_id IS NULL");
    } else if (opts.projectId) {
      where.push("s.project_id = ?");
      whereParams.push(opts.projectId);
    }
    if (q) {
      where.push("s.session_id IN (SELECT session_id FROM agent_messages_fts WHERE agent_messages_fts MATCH ?)");
      whereParams.push(q);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const snippetSel = q
      ? `, (SELECT snippet(agent_messages_fts, 2, '<mark>', '</mark>', '…', 8)
              FROM agent_messages_fts
             WHERE agent_messages_fts.session_id = s.session_id
               AND agent_messages_fts MATCH ?
             LIMIT 1) AS snippet`
      : "";

    const sql =
      `SELECT s.session_id, s.agent, s.project_id, s.cwd, s.worktree_label, s.branch,
              s.cwd_exists, s.parent_session_id, s.started_at, s.last_activity,
              s.message_count, s.first_user_msg, s.profile, s.permission_mode, s.launched_via,
              p.name AS project_name,
              COALESCE(t.input, 0)  AS input_tokens,
              COALESCE(t.output, 0) AS output_tokens,
              COALESCE(t.cache, 0)  AS cache_tokens
              ${snippetSel}
         FROM agent_sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         LEFT JOIN (
              SELECT session_id,
                     COALESCE(SUM(input_tokens), 0)  AS input,
                     COALESCE(SUM(output_tokens), 0) AS output,
                     COALESCE(SUM(cache_create_tokens), 0) + COALESCE(SUM(cache_read_tokens), 0) AS cache
                FROM agent_messages GROUP BY session_id
         ) t ON t.session_id = s.session_id
         ${whereSql}
         ORDER BY ${sortCol} ${dir}${nullsLast}, s.last_activity DESC, s.session_id ASC
         LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(*) AS n FROM agent_sessions s ${whereSql}`;

    try {
      const selParams = [...(q ? [q] : []), ...whereParams, limit, offset];
      const sessions = this.db.query<SessionListRow, unknown[]>(sql).all(...selParams);
      this.backfillFirstUserMsg(sessions);
      const total = this.db.query<{ n: number }, unknown[]>(countSql).get(...whereParams)?.n ?? 0;
      return { sessions, total };
    } catch {
      // Almost certainly an fts5 syntax error in `q` — treat as "no matches".
      return { sessions: [], total: 0 };
    }
  }

  tokensOverTime(opts: { days: number }): TokensOverTimePoint[] {
    const dayMs = 86_400_000;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startUtc = todayUtc - (opts.days - 1) * dayMs;
    const rows = this.db
      .query<{ day: string; input: number; output: number; cache: number }, [number]>(
        `SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS day,
                COALESCE(SUM(input_tokens), 0)  AS input,
                COALESCE(SUM(output_tokens), 0) AS output,
                COALESCE(SUM(cache_create_tokens), 0) + COALESCE(SUM(cache_read_tokens), 0) AS cache
           FROM agent_messages
          WHERE timestamp >= ?
          GROUP BY day`,
      )
      .all(startUtc);
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: TokensOverTimePoint[] = [];
    for (let i = 0; i < opts.days; i++) {
      const key = new Date(startUtc + i * dayMs).toISOString().slice(0, 10);
      const hit = byDay.get(key);
      out.push({ day: key, input: hit?.input ?? 0, output: hit?.output ?? 0, cache: hit?.cache ?? 0 });
    }
    return out;
  }

  tokensByProject(): TokensByProjectRow[] {
    const rows = this.db
      .query<
        { project_id: string | null; input: number; output: number; cache: number; sessions: number },
        []
      >(
        `SELECT s.project_id AS project_id,
                COALESCE(SUM(m.input_tokens), 0)  AS input,
                COALESCE(SUM(m.output_tokens), 0) AS output,
                COALESCE(SUM(m.cache_create_tokens), 0) + COALESCE(SUM(m.cache_read_tokens), 0) AS cache,
                COUNT(DISTINCT s.session_id) AS sessions
           FROM agent_sessions s
           LEFT JOIN agent_messages m ON m.session_id = s.session_id
          GROUP BY s.project_id`,
      )
      .all();
    const names = new Map(
      this.db.query<{ id: string; name: string }, []>("SELECT id, name FROM projects").all().map((p) => [p.id, p.name]),
    );
    return rows
      .map((r) => ({
        projectId: r.project_id,
        projectName: r.project_id ? names.get(r.project_id) ?? r.project_id : "unassigned",
        input: r.input,
        output: r.output,
        cache: r.cache,
        sessions: r.sessions,
      }))
      .sort((a, b) => b.input + b.output + b.cache - (a.input + a.output + a.cache));
  }

  listByProject(projectId: string, limit = 25, offset = 0): SessionRow[] {
    const rows = this.db
      .query<SessionRow, [string, number, number]>(
        `SELECT session_id, agent, project_id, cwd, worktree_label, branch,
                cwd_exists, parent_session_id, started_at, last_activity,
                message_count, first_user_msg, profile, permission_mode, launched_via
           FROM agent_sessions
          WHERE project_id = ?
          ORDER BY last_activity DESC
          LIMIT ? OFFSET ?`,
      )
      .all(projectId, limit, offset);
    this.backfillFirstUserMsg(rows);
    return rows;
  }

  // Rows ingested before their JSONL was scanned (or whose first line was a
  // permission-mode / file-history-snapshot record) carry a null first_user_msg.
  // Derive one on read from the earliest stored user message that has text.
  private backfillFirstUserMsg(rows: Array<{ session_id: string; first_user_msg: string | null }>): void {
    const query = this.db.query<{ content: string }, [string]>(
      `SELECT content FROM agent_messages
        WHERE session_id = ? AND role = 'user'
        ORDER BY timestamp ASC, id ASC
        LIMIT 10`,
    );
    for (const row of rows) {
      if (row.first_user_msg !== null) continue;
      for (const { content } of query.all(row.session_id)) {
        const text = firstUserText(content);
        if (text) {
          row.first_user_msg = text.slice(0, 200);
          break;
        }
      }
    }
  }

  getSessionDetail(sessionId: string): SessionDetail | undefined {
    const session = this.db
      .query<SessionRow, [string]>(
        `SELECT session_id, agent, project_id, cwd, worktree_label, branch,
                cwd_exists, parent_session_id, started_at, last_activity,
                message_count, first_user_msg, profile, permission_mode, launched_via
           FROM agent_sessions WHERE session_id = ?`,
      )
      .get(sessionId);
    if (!session) return undefined;
    const messages = this.db
      .query<SessionDetail["messages"][number], [string]>(
        `SELECT id, role, content, timestamp, model,
                input_tokens, cache_create_tokens, cache_read_tokens,
                output_tokens, stop_reason
           FROM agent_messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
      )
      .all(sessionId);
    const toolCalls = this.db
      .query<SessionDetail["toolCalls"][number], [string]>(
        `SELECT id, tool_use_id, tool_name, tool_input, started_at,
                finished_at, duration_ms, result_status, result_size
           FROM agent_tool_calls WHERE session_id = ? ORDER BY started_at ASC, id ASC`,
      )
      .all(sessionId);
    const events = this.db
      .query<SessionDetail["events"][number], [string]>(
        "SELECT id, kind, timestamp, payload FROM agent_session_events WHERE session_id = ? ORDER BY timestamp ASC, id ASC",
      )
      .all(sessionId);
    return { session, messages, toolCalls, events };
  }

  searchByProject(
    projectId: string,
    query: string,
    limit = 50,
  ): Array<SessionRow & { snippet: string }> {
    const rows = this.db
      .query<SessionRow & { snippet: string }, [string, string, number]>(
        `SELECT s.session_id, s.agent, s.project_id, s.cwd, s.worktree_label,
                s.branch, s.cwd_exists, s.parent_session_id, s.started_at,
                s.last_activity, s.message_count, s.first_user_msg, s.profile,
                s.permission_mode, s.launched_via,
                (SELECT snippet(agent_messages_fts, 2, '<mark>', '</mark>', '…', 8)
                   FROM agent_messages_fts
                  WHERE agent_messages_fts.session_id = s.session_id
                    AND agent_messages_fts MATCH ?2
                  LIMIT 1) AS snippet
           FROM agent_sessions s
          WHERE s.project_id = ?1
            AND s.session_id IN (
                  SELECT session_id FROM agent_messages_fts WHERE agent_messages_fts MATCH ?2
                )
          ORDER BY s.last_activity DESC
          LIMIT ?3`,
      )
      .all(projectId, query, limit);
    this.backfillFirstUserMsg(rows);
    return rows;
  }

  getSession(sessionId: string): SessionRow | undefined {
    return (
      this.db
        .query<SessionRow, [string]>(
          `SELECT session_id, agent, project_id, cwd, worktree_label, branch,
                  cwd_exists, parent_session_id, started_at, last_activity,
                  message_count, first_user_msg, profile, permission_mode, launched_via
             FROM agent_sessions WHERE session_id = ?`,
        )
        .get(sessionId) ?? undefined
    );
  }

  mtimeFor(sessionId: string): number | undefined {
    return this.db
      .query<{ last_activity: number }, [string]>(
        "SELECT last_activity FROM agent_sessions WHERE session_id = ?",
      )
      .get(sessionId)?.last_activity;
  }

  lastAssistantText(sessionId: string): string | null {
    const row = this.db
      .query<{ content: string }, [string]>(
        `SELECT content FROM agent_messages
         WHERE session_id = ? AND role = 'assistant' AND content <> ''
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(sessionId);
    if (!row) return null;
    const t = row.content.trim();
    return t.length > 140 ? t.slice(0, 139) + "…" : t;
  }

  recentSessions(limit = 20): Array<SessionRow & { project_name: string | null }> {
    return this.db
      .query<SessionRow & { project_name: string | null }, [number]>(
        `SELECT s.*, p.name AS project_name
         FROM agent_sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.parent_session_id IS NULL
         ORDER BY s.last_activity DESC
         LIMIT ?`,
      )
      .all(limit);
  }
}
