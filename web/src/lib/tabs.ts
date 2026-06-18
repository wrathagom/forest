export type Tab =
  | { kind: "terminal"; id: string; sessionId: string; label: string; agent: string | null }
  | { kind: "file"; id: string; path: string; label: string; dirty: boolean }
  | { kind: "diff"; id: string; path: string; label: string }
  | { kind: "commit"; id: string; sha: string; label: string }
  | { kind: "session"; id: string; sessionId: string; label: string }
  | { kind: "task"; id: string; taskId: string; label: string };

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

export function loadExpandedDirs(projectId: string): string[] {
  return read<string[]>(`fileTree.expanded.${projectId}`, []);
}

export function saveExpandedDirs(projectId: string, dirs: string[]): void {
  write(`fileTree.expanded.${projectId}`, dirs);
}
