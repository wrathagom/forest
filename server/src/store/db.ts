import { Database } from "bun:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    hidden      INTEGER NOT NULL DEFAULT 0,
    group_name  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    scanned_at  INTEGER NOT NULL,
    payload     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id        TEXT PRIMARY KEY,
    agent             TEXT NOT NULL,
    project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
    cwd               TEXT NOT NULL,
    worktree_label    TEXT,
    branch            TEXT,
    cwd_exists        INTEGER NOT NULL DEFAULT 1,
    parent_session_id TEXT,
    started_at        INTEGER,
    last_activity     INTEGER NOT NULL,
    message_count     INTEGER NOT NULL DEFAULT 0,
    first_user_msg    TEXT,
    profile           TEXT,
    imported_at       INTEGER NOT NULL,
    source            TEXT NOT NULL,
    permission_mode   TEXT,
    launched_via      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_project
    ON agent_sessions(project_id);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_activity
    ON agent_sessions(last_activity DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent
    ON agent_sessions(parent_session_id);

  CREATE TABLE IF NOT EXISTS agent_messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    uuid                TEXT,
    role                TEXT NOT NULL,
    content             TEXT NOT NULL,
    timestamp           INTEGER NOT NULL,
    model               TEXT,
    input_tokens        INTEGER,
    cache_create_tokens INTEGER,
    cache_read_tokens   INTEGER,
    output_tokens       INTEGER,
    stop_reason         TEXT,
    UNIQUE(session_id, uuid)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_messages_session
    ON agent_messages(session_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_agent_messages_timestamp
    ON agent_messages(timestamp);
  -- Covering index for the tokens-over-time chart: the day-bucketed SUMs read
  -- only these columns, so this lets the 30-day scan skip the (large) message
  -- rows entirely instead of touching the content column.
  CREATE INDEX IF NOT EXISTS idx_agent_messages_ts_tokens
    ON agent_messages(timestamp, session_id, input_tokens, output_tokens,
                      cache_create_tokens, cache_read_tokens);

  CREATE VIRTUAL TABLE IF NOT EXISTS agent_messages_fts USING fts5(
    session_id UNINDEXED,
    message_id UNINDEXED,
    text,
    tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    message_id      INTEGER REFERENCES agent_messages(id) ON DELETE CASCADE,
    tool_use_id     TEXT NOT NULL,
    tool_name        TEXT NOT NULL,
    tool_input      TEXT,
    started_at      INTEGER NOT NULL,
    finished_at     INTEGER,
    duration_ms     INTEGER,
    result_status   TEXT,
    result_size     INTEGER,
    UNIQUE(session_id, tool_use_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tool_calls_session
    ON agent_tool_calls(session_id);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_name
    ON agent_tool_calls(tool_name);

  CREATE TABLE IF NOT EXISTS agent_session_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    payload     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_session_events_session
    ON agent_session_events(session_id, timestamp);

  -- sessions the user explicitly marked "done" from the mobile UI; survives restarts
  CREATE TABLE IF NOT EXISTS agent_session_dismissals (
    session_id    TEXT PRIMARY KEY,
    dismissed_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    intent          TEXT NOT NULL,
    status          TEXT NOT NULL,
    base_branch     TEXT NOT NULL,
    branch          TEXT,
    worktree_path   TEXT,
    session_id      TEXT,
    pty_session_id  TEXT,
    result          TEXT,
    result_ref      TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    launched_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_project
    ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks(status);

  CREATE TABLE IF NOT EXISTS agent_session_summaries (
    session_id            TEXT PRIMARY KEY
                            REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    summary               TEXT,
    moments               TEXT NOT NULL DEFAULT '[]',
    model                 TEXT,
    status                TEXT NOT NULL,
    error                 TEXT,
    generated_at          INTEGER NOT NULL,
    source_last_activity  INTEGER NOT NULL,
    source_message_count  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_ngrams (
    agent   TEXT NOT NULL,
    n       INTEGER NOT NULL,
    phrase  TEXT NOT NULL,
    month   TEXT NOT NULL,        -- 'YYYY-MM' bucket of the message timestamp
    count   INTEGER NOT NULL,
    PRIMARY KEY (agent, n, phrase, month)
  );
  CREATE INDEX IF NOT EXISTS idx_ngrams_lookup ON agent_ngrams(agent, n);
`;

// IMPORTANT: table, column, and decl must be literal (hard-coded) strings — they are interpolated directly into SQL, not parameterised.
// Returns true when the column was actually added (so callers can run a
// one-time backfill), false when it already existed.
function addColumnIfMissing(db: Database, table: string, column: string, decl: string): boolean {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  return true;
}

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL"); // no-op on :memory: — that's fine
  db.exec("PRAGMA foreign_keys = ON");
  // Apply the schema atomically so a crash mid-apply can't leave us with a
  // partially-initialised database.
  db.transaction(() => db.exec(SCHEMA))();
  addColumnIfMissing(db, "agent_sessions", "permission_mode", "TEXT");
  addColumnIfMissing(db, "agent_sessions", "launched_via", "TEXT");
  addColumnIfMissing(db, "agent_sessions", "profile", "TEXT");
  addColumnIfMissing(db, "agent_sessions", "title", "TEXT");

  // Denormalized per-session token totals, maintained at ingest so the sessions
  // list and token charts never re-sum the whole agent_messages table. When the
  // columns are first added, backfill them once from the existing messages.
  const addedInput = addColumnIfMissing(db, "agent_sessions", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
  const addedOutput = addColumnIfMissing(db, "agent_sessions", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
  const addedCache = addColumnIfMissing(db, "agent_sessions", "cache_tokens", "INTEGER NOT NULL DEFAULT 0");
  if (addedInput || addedOutput || addedCache) {
    db.exec(`
      UPDATE agent_sessions SET
        input_tokens  = (SELECT COALESCE(SUM(input_tokens),  0) FROM agent_messages WHERE session_id = agent_sessions.session_id),
        output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM agent_messages WHERE session_id = agent_sessions.session_id),
        cache_tokens  = (SELECT COALESCE(SUM(cache_create_tokens), 0) + COALESCE(SUM(cache_read_tokens), 0) FROM agent_messages WHERE session_id = agent_sessions.session_id)
    `);
  }
  return db;
}
