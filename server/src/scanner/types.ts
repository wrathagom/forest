export type Snapshot = {
  git: {
    branch: string | null;
    dirty: boolean;
    changed: number;
    ahead: number;
    behind: number;
    lastCommit: { sha: string; message: string; timestamp: number } | null;
  };
  lastEdit: number | null;
  services: {
    docker: { name: string; state: "running" | "stopped"; from: "compose" }[];
    processes: { pid: number; command: string; cwd: string; ports: number[] }[];
  };
  errors: string[];
};

export type GitProbe = (path: string, signal: AbortSignal) => Promise<Partial<Snapshot["git"]> & { lastEdit?: number | null; errors?: string[] }>;
export type DockerProbe = (path: string, signal: AbortSignal) => Promise<{ services: Snapshot["services"]["docker"]; errors?: string[] }>;
export type ProcessProbe = (path: string, signal: AbortSignal) => Promise<{ processes: Snapshot["services"]["processes"]; errors?: string[] }>;

export type Probes = {
  git: GitProbe;
  docker: DockerProbe;
  processes: ProcessProbe;
};

export const PER_PROJECT_TIMEOUT_MS = 10_000;

export function emptySnapshot(): Snapshot {
  return {
    git: { branch: null, dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: null,
    services: { docker: [], processes: [] },
    errors: [],
  };
}
