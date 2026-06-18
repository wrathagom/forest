import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { DockerProbe, Snapshot } from "./types";

type Deps = {
  runDockerCli: (args: string[], cwd: string, signal: AbortSignal) => Promise<string>;
};

const defaultRun: Deps["runDockerCli"] = (args, cwd, signal) =>
  new Promise((resolve, reject) => {
    const p = spawn("docker", args, { cwd, signal });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`))));
  });

function findComposeFile(path: string): string | null {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const p = join(path, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function parseDeclaredServices(yaml: string): string[] {
  // Minimal parser: scan for top-level `services:` block, list 2-space-indented keys.
  // Acceptable for v1 — most compose files keep services flat; deeper nesting is rare.
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inServices = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices) {
      if (/^[^\s]/.test(line)) {
        inServices = false;
        continue;
      }
      const m = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
      if (m && m[1]) out.push(m[1]);
    }
  }
  return out;
}

type PsRow = { Service?: string; Name?: string; State?: string };

export const probeDocker = (deps: Deps = { runDockerCli: defaultRun }): DockerProbe => async (path, signal) => {
  const compose = findComposeFile(path);
  if (!compose) return { services: [] };

  let declared: string[];
  try {
    declared = parseDeclaredServices(readFileSync(compose, "utf8"));
  } catch (err) {
    return { services: [], errors: [`compose parse: ${(err as Error).message}`] };
  }
  if (declared.length === 0) return { services: [] };

  let raw: string;
  try {
    raw = await deps.runDockerCli(["compose", "ps", "--all", "--format", "json"], path, signal);
  } catch {
    // Daemon unreachable (not running, not installed, etc.) — nothing to report.
    return { services: [] };
  }

  // `docker compose ps --format json` outputs either a JSON array (newer compose)
  // or NDJSON (older compose). Handle both.
  const rows: PsRow[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      rows.push(...(JSON.parse(trimmed) as PsRow[]));
    } catch (err) {
      return { services: [], errors: [`docker output: ${(err as Error).message}`] };
    }
  } else {
    for (const line of trimmed.split(/\r?\n/).filter(Boolean)) {
      try {
        rows.push(JSON.parse(line) as PsRow);
      } catch {
        // skip malformed lines
      }
    }
  }

  const services: Snapshot["services"]["docker"] = declared.map((name) => {
    const row = rows.find((r) => r.Service === name);
    const state = row?.State === "running" ? "running" : "stopped";
    return { name, state, from: "compose" as const };
  });
  return { services };
};

// Convenience wrapper so most callers don't construct deps:
export const defaultDockerProbe = probeDocker();

export type ContainerDetail = {
  service: string;
  state: "running" | "exited" | "stopped" | "paused" | "unknown";
  containerName: string;
  image: string;
  ports: { host: string; container: number; protocol: "tcp" | "udp" }[];
  startedAt: number | null;
  exitCode: number | null;
  health: "healthy" | "unhealthy" | "starting" | null;
};

type DetailRow = {
  Service?: string;
  Name?: string;
  State?: string;
  Image?: string;
  CreatedAt?: string;
  ExitCode?: number | null;
  Health?: string | null;
  Publishers?: Array<{ URL?: string; PublishedPort?: number; TargetPort?: number; Protocol?: string }>;
};

function normalizeState(s: string | undefined): ContainerDetail["state"] {
  if (s === "running" || s === "exited" || s === "stopped" || s === "paused") return s;
  return "unknown";
}

function normalizeHealth(h: string | null | undefined): ContainerDetail["health"] {
  if (h === "healthy" || h === "unhealthy" || h === "starting") return h;
  return null;
}

function parseDetailRows(raw: string): DetailRow[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as DetailRow[];
    } catch {
      return [];
    }
  }
  const rows: DetailRow[] = [];
  for (const line of trimmed.split(/\r?\n/).filter(Boolean)) {
    try {
      rows.push(JSON.parse(line) as DetailRow);
    } catch {
      // skip malformed
    }
  }
  return rows;
}

export function probeContainerDetail(deps: Deps = { runDockerCli: defaultRun }) {
  return async (path: string, signal?: AbortSignal): Promise<ContainerDetail[]> => {
    const compose = findComposeFile(path);
    if (!compose) return [];

    let raw: string;
    try {
      raw = await deps.runDockerCli(["compose", "ps", "--all", "--format", "json"], path, signal ?? new AbortController().signal);
    } catch {
      return [];
    }

    return parseDetailRows(raw).map((row): ContainerDetail => {
      const ports = (row.Publishers ?? [])
        .filter((p) => typeof p.PublishedPort === "number" && typeof p.TargetPort === "number")
        .map((p) => ({
          host: p.URL ?? "0.0.0.0",
          container: p.TargetPort!,
          protocol: (p.Protocol === "udp" ? "udp" : "tcp") as "tcp" | "udp",
        }));
      const startedAtMs = row.CreatedAt ? new Date(row.CreatedAt).getTime() : NaN;
      return {
        service: row.Service ?? "unknown",
        state: normalizeState(row.State),
        containerName: row.Name ?? "",
        image: row.Image ?? "",
        ports,
        startedAt: Number.isFinite(startedAtMs) ? startedAtMs : null,
        exitCode: typeof row.ExitCode === "number" ? row.ExitCode : null,
        health: normalizeHealth(row.Health),
      };
    });
  };
}

export const defaultContainerDetailProbe = probeContainerDetail();
