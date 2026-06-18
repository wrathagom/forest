import type { Snapshot } from "./scanner/types";

export type LoopDeps = {
  intervalMs: number;
  listVisible: () => { id: string; path: string }[];
  scanProject: (path: string) => Promise<Snapshot>;
  onSnapshot: (projectId: string, snapshot: Snapshot) => void;
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
  concurrency?: number;
};

export type Loop = {
  start: () => void;
  stop: () => void;
  refresh: (projectId: string) => Promise<Snapshot | null>;
  lastTickAt: () => number | null;
};

export function createLoop(deps: LoopDeps): Loop {
  const concurrency = deps.concurrency ?? 4;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTickAt: number | null = null;
  let busy = false;

  async function runOnce(projects: { id: string; path: string }[]) {
    let i = 0;
    async function worker() {
      while (i < projects.length) {
        const idx = i++;
        const p = projects[idx]!;
        try {
          const snap = await deps.scanProject(p.path);
          deps.onSnapshot(p.id, snap);
        } catch (err) {
          deps.log("warn", "scan failed", { id: p.id, error: (err as Error).message });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, projects.length) }, worker));
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const projects = deps.listVisible();
      lastTickAt = Date.now();
      await runOnce(projects);
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.intervalMs);
      void tick(); // immediate first tick
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async refresh(projectId) {
      const project = deps.listVisible().find((p) => p.id === projectId);
      if (!project) return null;
      const snap = await deps.scanProject(project.path);
      deps.onSnapshot(project.id, snap);
      return snap;
    },
    lastTickAt: () => lastTickAt,
  };
}
