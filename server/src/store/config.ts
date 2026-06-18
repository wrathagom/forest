import type { Database } from "bun:sqlite";

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const MIN_POLL_INTERVAL_MS = 1_000;

export function getConfig(db: Database, key: string): string | undefined {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?").get(key);
  return row?.value;
}

export function setConfig(db: Database, key: string, value: string): void {
  db.query(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function getScanRoot(db: Database): string | undefined {
  return getConfig(db, "scan_root");
}

export function setScanRoot(db: Database, path: string): void {
  setConfig(db, "scan_root", path);
}

export function getPollIntervalMs(db: Database): number {
  const raw = getConfig(db, "poll_interval_ms");
  if (raw === undefined) return DEFAULT_POLL_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_MS ? n : DEFAULT_POLL_INTERVAL_MS;
}

export function setPollIntervalMs(db: Database, ms: number): void {
  setConfig(db, "poll_interval_ms", String(Math.max(MIN_POLL_INTERVAL_MS, Math.floor(ms))));
}

export const DEFAULT_SESSION_MAX_TOTAL = 32;
export const DEFAULT_SESSION_MAX_SCROLLBACK_LINES = 10_000;
export const MIN_SESSION_MAX_TOTAL = 1;
export const MIN_SESSION_MAX_SCROLLBACK_LINES = 100;

export function getSessionMaxTotal(db: import("bun:sqlite").Database): number {
  const raw = getConfig(db, "session_max_total");
  if (raw === undefined) return DEFAULT_SESSION_MAX_TOTAL;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_SESSION_MAX_TOTAL ? n : DEFAULT_SESSION_MAX_TOTAL;
}

export function setSessionMaxTotal(db: import("bun:sqlite").Database, n: number): void {
  setConfig(db, "session_max_total", String(Math.max(MIN_SESSION_MAX_TOTAL, Math.floor(n))));
}

export function getSessionMaxScrollbackLines(db: import("bun:sqlite").Database): number {
  const raw = getConfig(db, "session_max_scrollback_lines");
  if (raw === undefined) return DEFAULT_SESSION_MAX_SCROLLBACK_LINES;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_SESSION_MAX_SCROLLBACK_LINES
    ? n
    : DEFAULT_SESSION_MAX_SCROLLBACK_LINES;
}

export function setSessionMaxScrollbackLines(db: import("bun:sqlite").Database, n: number): void {
  setConfig(db, "session_max_scrollback_lines", String(Math.max(MIN_SESSION_MAX_SCROLLBACK_LINES, Math.floor(n))));
}

export function getSessionDefaultShell(db: import("bun:sqlite").Database): string {
  const raw = getConfig(db, "session_default_shell");
  if (raw && raw.length > 0) return raw;
  return process.env.SHELL ?? "/bin/bash";
}

export function setSessionDefaultShell(db: import("bun:sqlite").Database, shell: string): void {
  setConfig(db, "session_default_shell", shell);
}

export const PROJECT_SUBDIRS_KEY = "project_subdirs";

export function getProjectSubdirs(db: import("bun:sqlite").Database): string[] {
  const raw = getConfig(db, PROJECT_SUBDIRS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// A sub-dir entry can be a single segment ("Personal") or a slash-separated
// path of segments ("Professional/Customers"). Each segment must match the
// safe-name regex; "." and ".." are rejected to block path traversal; leading,
// trailing, or repeated slashes are rejected because they produce empty
// segments.
const SUBDIR_SEGMENT = /^[A-Za-z0-9._-]+$/;

function isValidSubdir(s: string): boolean {
  if (s.length === 0) return false;
  const parts = s.split("/");
  return parts.every((p) => p.length > 0 && p !== "." && p !== ".." && SUBDIR_SEGMENT.test(p));
}

export function setProjectSubdirs(db: import("bun:sqlite").Database, subdirs: string[]): void {
  const valid = subdirs.map((s) => s.trim()).filter(isValidSubdir);
  setConfig(db, PROJECT_SUBDIRS_KEY, JSON.stringify([...new Set(valid)]));
}

export function getAgentSessionsInstallHooks(db: import("bun:sqlite").Database): boolean {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?")
    .get("agentSessions.installHooks");
  return row ? row.value === "true" : true; // default ON
}

export type LauncherEntry = {
  id: string;
  label: string;
  command: string | null;
  args: string[];
  agent?: string;
};

const DEFAULT_LAUNCHERS: LauncherEntry[] = [
  { id: "shell",         label: "shell",          command: null,     args: [] },
  { id: "claude",        label: "claude",         command: "claude", args: [],          agent: "claude" },
  { id: "claude-resume", label: "claude --resume",command: "claude", args: ["--resume"],agent: "claude" },
  { id: "codex",         label: "codex",          command: "codex",  args: [],          agent: "codex"  },
];

export function getLaunchers(db: import("bun:sqlite").Database): LauncherEntry[] {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?")
    .get("terminals.launchers");
  if (!row) return DEFAULT_LAUNCHERS;
  try {
    const parsed = JSON.parse(row.value) as LauncherEntry[];
    return Array.isArray(parsed) ? parsed : DEFAULT_LAUNCHERS;
  } catch {
    return DEFAULT_LAUNCHERS;
  }
}

export function setLaunchers(db: import("bun:sqlite").Database, value: LauncherEntry[]): void {
  db.query(
    `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run("terminals.launchers", JSON.stringify(value));
}

export type CaffeinateState = {
  startedAt: number;
  durationSec: number | null;
};

const CAFFEINATE_STATE_KEY = "caffeinate.state";

export function getCaffeinateState(db: import("bun:sqlite").Database): CaffeinateState | null {
  const raw = getConfig(db, CAFFEINATE_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CaffeinateState>;
    if (typeof parsed.startedAt !== "number") return null;
    if (parsed.durationSec !== null && typeof parsed.durationSec !== "number") return null;
    return { startedAt: parsed.startedAt, durationSec: parsed.durationSec ?? null };
  } catch {
    return null;
  }
}

export function setCaffeinateState(db: import("bun:sqlite").Database, state: CaffeinateState): void {
  setConfig(db, CAFFEINATE_STATE_KEY, JSON.stringify(state));
}

export function clearCaffeinateState(db: import("bun:sqlite").Database): void {
  db.query("DELETE FROM config WHERE key = ?").run(CAFFEINATE_STATE_KEY);
}

export type BbsConfig = {
  enabled: boolean;
  accountKey: string | null;
  baseUrl: string;
  screenId: string | null;
  screenKey: string | null;
  alertLingerSec: number;
  hudIntervalMs: number;
  rotationIntervalSec: number;
  hudPanelCap: number;
  alertEvents: string[];
};

const BBS_DEFAULTS = {
  baseUrl: "https://app.bigbeautifulscreens.com",
  alertLingerSec: 60,
  hudIntervalMs: 30_000,
  rotationIntervalSec: 8,
  hudPanelCap: 6,
  alertEvents: ["waiting", "stop"] as string[],
};

export function getBbsConfig(db: import("bun:sqlite").Database): BbsConfig {
  const num = (key: string, def: number, min: number): number => {
    const raw = getConfig(db, key);
    const n = raw === undefined ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= min ? n : def;
  };
  let alertEvents = BBS_DEFAULTS.alertEvents;
  const rawAE = getConfig(db, "bbs_alert_events");
  if (rawAE) {
    try {
      const parsed = JSON.parse(rawAE);
      if (Array.isArray(parsed)) alertEvents = parsed.filter((x) => typeof x === "string");
    } catch {
      /* keep default */
    }
  }
  return {
    enabled: getConfig(db, "bbs_enabled") === "true",
    accountKey: getConfig(db, "bbs_account_key") ?? null,
    baseUrl: getConfig(db, "bbs_base_url") ?? BBS_DEFAULTS.baseUrl,
    screenId: getConfig(db, "bbs_screen_id") ?? null,
    screenKey: getConfig(db, "bbs_screen_key") ?? null,
    alertLingerSec: num("bbs_alert_linger_sec", BBS_DEFAULTS.alertLingerSec, 5),
    hudIntervalMs: num("bbs_hud_interval_ms", BBS_DEFAULTS.hudIntervalMs, 5_000),
    rotationIntervalSec: num("bbs_rotation_interval_sec", BBS_DEFAULTS.rotationIntervalSec, 1),
    hudPanelCap: num("bbs_hud_panel_cap", BBS_DEFAULTS.hudPanelCap, 1),
    alertEvents,
  };
}

export type BbsConfigInput = Partial<{
  enabled: boolean;
  accountKey: string;
  baseUrl: string;
  screenId: string;
  screenKey: string;
  alertLingerSec: number;
  hudIntervalMs: number;
  rotationIntervalSec: number;
  hudPanelCap: number;
  alertEvents: string[];
}>;

export function setBbsConfig(db: import("bun:sqlite").Database, input: BbsConfigInput): void {
  if (typeof input.enabled === "boolean") setConfig(db, "bbs_enabled", String(input.enabled));
  if (typeof input.accountKey === "string") setConfig(db, "bbs_account_key", input.accountKey.trim());
  if (typeof input.baseUrl === "string") setConfig(db, "bbs_base_url", input.baseUrl.trim().replace(/\/$/, ""));
  if (typeof input.screenId === "string") setConfig(db, "bbs_screen_id", input.screenId);
  if (typeof input.screenKey === "string") setConfig(db, "bbs_screen_key", input.screenKey.trim());
  if (typeof input.alertLingerSec === "number") setConfig(db, "bbs_alert_linger_sec", String(Math.max(5, Math.floor(input.alertLingerSec))));
  if (typeof input.hudIntervalMs === "number") setConfig(db, "bbs_hud_interval_ms", String(Math.max(5_000, Math.floor(input.hudIntervalMs))));
  if (typeof input.rotationIntervalSec === "number") setConfig(db, "bbs_rotation_interval_sec", String(Math.max(1, Math.floor(input.rotationIntervalSec))));
  if (typeof input.hudPanelCap === "number") setConfig(db, "bbs_hud_panel_cap", String(Math.max(1, Math.floor(input.hudPanelCap))));
  if (Array.isArray(input.alertEvents)) setConfig(db, "bbs_alert_events", JSON.stringify(input.alertEvents.filter((x) => typeof x === "string")));
}

export function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}
