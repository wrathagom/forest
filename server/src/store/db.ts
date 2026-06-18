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
`;

// IMPORTANT: table, column, and decl must be literal (hard-coded) strings — they are interpolated directly into SQL, not parameterised.
function addColumnIfMissing(db: Database, table: string, column: string, decl: string): void {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
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
  return db;
}
