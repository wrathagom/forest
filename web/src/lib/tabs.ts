export type Tab =
  | { kind: "terminal"; id: string; sessionId: string; label: string; agent: string | null }
  | { kind: "file"; id: string; path: string; label: string; dirty: boolean }
  | { kind: "diff"; id: string; path: string; label: string }
  | { kind: "commit"; id: string; sha: string; label: string }
  | { kind: "session"; id: string; sessionId: string; label: string }
  | { kind: "task"; id: string; taskId: string; label: string };

/** Tab ids are `<kind>:<key>`. Only file tabs may be pinned to the right pane. */
export const FILE_PREFIX = "file:";

export function isFileId(id: string | null): boolean {
  return typeof id === "string" && id.startsWith(FILE_PREFIX);
}

const PREFIX = "forest.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // private mode / quota — silently drop
  }
}

export function loadOpenFiles(projectId: string): string[] {
  return read<string[]>(`openFiles.${projectId}`, []);
}

export function saveOpenFiles(projectId: string, paths: string[]): void {
  write(`openFiles.${projectId}`, paths);
}

export function loadActiveTab(projectId: string): string | null {
  return read<string | null>(`activeTab.${projectId}`, null);
}

export function saveActiveTab(projectId: string, id: string | null): void {
  write(`activeTab.${projectId}`, id);
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
const DEFAULT_RATIO = 0.5;

export function clampRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export function saveSecondaryTab(projectId: string, id: string | null): void {
  write(`secondaryTab.${projectId}`, id);
}

/**
 * The tab pinned to the right pane. localStorage outlives file deletions and
 * tabs closed elsewhere, so this validates the spec's invariants rather than
 * trusting what it reads: the id must name a `file:` tab that is currently
 * open, and must not be the active tab.
 */
export function loadSecondaryTab(projectId: string): string | null {
  const raw = read<unknown>(`secondaryTab.${projectId}`, null);
  if (typeof raw !== "string" || !isFileId(raw)) return null;
  if (!loadOpenFiles(projectId).includes(raw.slice(FILE_PREFIX.length))) return null;
  if (raw === loadActiveTab(projectId)) return null;
  return raw;
}

export function saveSplitRatio(projectId: string, ratio: number): void {
  write(`splitRatio.${projectId}`, ratio);
}

export function loadSplitRatio(projectId: string): number {
  return clampRatio(read<unknown>(`splitRatio.${projectId}`, null));
}

export function loadExpandedDirs(projectId: string): string[] {
  return read<string[]>(`fileTree.expanded.${projectId}`, []);
}

export function saveExpandedDirs(projectId: string, dirs: string[]): void {
  write(`fileTree.expanded.${projectId}`, dirs);
}
