import { emptySnapshot, PER_PROJECT_TIMEOUT_MS } from "./types";
import type { Probes, Snapshot } from "./types";

type Options = { timeoutMs?: number };

export async function scanProject(
  path: string,
  probes: Probes,
  opts: Options = {}
): Promise<Snapshot> {
  const timeoutMs = opts.timeoutMs ?? PER_PROJECT_TIMEOUT_MS;
  const snap = emptySnapshot();
  const errors: string[] = [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const settle = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(ctrl.signal.aborted ? `${name}: timed out` : `${name}: ${msg}`);
      return null;
    }
  };

  try {
    const [git, docker, processes] = await Promise.all([
      settle("git", () => probes.git(path, ctrl.signal)),
      settle("docker", () => probes.docker(path, ctrl.signal)),
      settle("processes", () => probes.processes(path, ctrl.signal)),
    ]);
    if (git) {
      snap.git = { ...snap.git, ...git };
      if (git.lastEdit !== undefined) snap.lastEdit = git.lastEdit;
      if (git.errors) errors.push(...git.errors.map((e) => `git: ${e}`));
    }
    if (docker) {
      snap.services.docker = docker.services;
      if (docker.errors) errors.push(...docker.errors.map((e) => `docker: ${e}`));
    }
    if (processes) {
      snap.services.processes = processes.processes;
      if (processes.errors) errors.push(...processes.errors.map((e) => `processes: ${e}`));
    }
  } finally {
    clearTimeout(timer);
  }

  snap.errors = errors;
  return snap;
}
