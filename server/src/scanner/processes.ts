import { spawn } from "node:child_process";
import { readlinkSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import type { ProcessProbe } from "./types";

export type ProcRow = { pid: number; command: string; cwd: string | null; ports: number[] };

export type ProcessDetail = {
  pid: number;
  ppid: number;
  command: string;
  cwd: string;
  user: string;
  cpu: number;
  memMB: number;
  startedAt: number;     // ms epoch (NaN if unparseable)
  ports: number[];
};

type Deps = {
  listProcesses: (signal: AbortSignal) => Promise<ProcRow[]>;
  cacheTtlMs?: number;
  // The system-wide ps+lsof used by the default cache path. Overridable for tests.
  bulkScan: (signal: AbortSignal) => Promise<ProcRow[]>;
};

function spawnCollect(cmd: string, args: string[], signal: AbortSignal): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { signal });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.on("error", () => resolve({ stdout, code: -1 }));
    p.on("close", (code) => resolve({ stdout, code: code ?? -1 }));
  });
}

function parsePs(out: string): { pid: number; command: string }[] {
  const rows: { pid: number; command: string }[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: parseInt(m[1]!, 10), command: m[2]! });
  }
  return rows;
}

// Walk `lsof -F pn` output and call `eachName` for every (pid, name) pair.
// Lines starting with `p<pid>` open a record; subsequent `n<value>` lines
// belong to that pid until the next `p` line.
function parseLsofPn(out: string, eachName: (pid: number, name: string) => void): void {
  let currentPid = -1;
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const tag = line[0];
    const rest = line.slice(1);
    if (tag === "p") {
      const n = parseInt(rest, 10);
      currentPid = Number.isFinite(n) ? n : -1;
    } else if (tag === "n" && currentPid > 0) {
      eachName(currentPid, rest);
    }
  }
}

function parsePort(name: string): number | null {
  // Address forms: "*:3000", "127.0.0.1:5173", "[::1]:8080".
  const idx = name.lastIndexOf(":");
  if (idx < 0) return null;
  const port = parseInt(name.slice(idx + 1), 10);
  return Number.isFinite(port) && port > 0 ? port : null;
}

async function defaultListProcessesMac(signal: AbortSignal): Promise<ProcRow[]> {
  const [ps, lsofCwd, lsofPorts] = await Promise.all([
    spawnCollect("ps", ["-axwwo", "pid=,command="], signal),
    spawnCollect("lsof", ["-nP", "-F", "pn", "-a", "-d", "cwd"], signal),
    spawnCollect("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], signal),
  ]);

  const cwds = new Map<number, string>();
  parseLsofPn(lsofCwd.stdout, (pid, name) => {
    cwds.set(pid, name);
  });

  const ports = new Map<number, Set<number>>();
  parseLsofPn(lsofPorts.stdout, (pid, name) => {
    const p = parsePort(name);
    if (p === null) return;
    let set = ports.get(pid);
    if (!set) {
      set = new Set();
      ports.set(pid, set);
    }
    set.add(p);
  });

  const rows: ProcRow[] = [];
  for (const proc of parsePs(ps.stdout)) {
    rows.push({
      pid: proc.pid,
      command: proc.command,
      cwd: cwds.get(proc.pid) ?? null,
      ports: ports.has(proc.pid) ? [...ports.get(proc.pid)!].sort((a, b) => a - b) : [],
    });
  }
  return rows;
}

async function defaultListProcessesLinux(signal: AbortSignal): Promise<ProcRow[]> {
  const [ps, lsofPorts] = await Promise.all([
    spawnCollect("ps", ["-axwwo", "pid=,command="], signal),
    spawnCollect("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], signal),
  ]);

  // /proc/<pid>/cwd is faster than lsof on Linux.
  const cwds = new Map<number, string>();
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pid = parseInt(entry.name, 10);
      if (!Number.isFinite(pid)) continue;
      try {
        cwds.set(pid, readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // process exited, or we lack permission
      }
    }
  } catch {
    // /proc unavailable
  }

  const ports = new Map<number, Set<number>>();
  parseLsofPn(lsofPorts.stdout, (pid, name) => {
    const p = parsePort(name);
    if (p === null) return;
    let set = ports.get(pid);
    if (!set) {
      set = new Set();
      ports.set(pid, set);
    }
    set.add(p);
  });

  const rows: ProcRow[] = [];
  for (const proc of parsePs(ps.stdout)) {
    rows.push({
      pid: proc.pid,
      command: proc.command,
      cwd: cwds.get(proc.pid) ?? null,
      ports: ports.has(proc.pid) ? [...ports.get(proc.pid)!].sort((a, b) => a - b) : [],
    });
  }
  return rows;
}

const defaultList = platform() === "linux" ? defaultListProcessesLinux : defaultListProcessesMac;

// Module-level cache + single-flight so every concurrent project scan in a tick
// shares ONE system-wide ps+lsof. Without the single-flight guard, the loop's
// (up to 4) parallel project scans each spawned their own `lsof -d cwd` over
// every process on the machine — ~4× the load, which routinely blew the 10s
// per-project timeout and left the cwd map incomplete, so the process counts
// (notably Forest's own card) oscillated between 0 and N tick to tick. The
// shared scan also gets its own short timeout, decoupled from per-project
// aborts, so a slow git/docker probe on one project can't kill it mid-output.
const BULK_SCAN_TIMEOUT_MS = 8_000;
let bulkCache: { rows: ProcRow[]; expires: number } | null = null;
let bulkInFlight: Promise<ProcRow[]> | null = null;

function refreshBulk(scan: (signal: AbortSignal) => Promise<ProcRow[]>, ttl: number): Promise<ProcRow[]> {
  if (bulkInFlight) return bulkInFlight;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BULK_SCAN_TIMEOUT_MS);
  bulkInFlight = (async () => {
    try {
      const rows = await scan(ctrl.signal);
      // If the scan finished cleanly, cache it. If our own timeout fired (so the
      // ps/lsof children were killed mid-output), keep whatever we had rather
      // than blanking every card — staleness beats oscillation.
      if (!ctrl.signal.aborted) {
        bulkCache = { rows, expires: Date.now() + ttl };
        return rows;
      }
      return bulkCache?.rows ?? rows;
    } catch {
      return bulkCache?.rows ?? [];
    } finally {
      clearTimeout(timer);
      bulkInFlight = null;
    }
  })();
  return bulkInFlight;
}

function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + "/");
}

export function probeProcesses(deps: Partial<Deps> = {}): ProcessProbe {
  const ttl = deps.cacheTtlMs ?? 5_000;
  const bulkScan = deps.bulkScan ?? defaultList;
  const list: (signal: AbortSignal) => Promise<ProcRow[]> =
    deps.listProcesses ??
    (async (_signal: AbortSignal): Promise<ProcRow[]> => {
      if (bulkCache && bulkCache.expires > Date.now()) return bulkCache.rows;
      return refreshBulk(bulkScan, ttl);
    });

  return async (path, signal) => {
    const rows = await list(signal);
    const out: { pid: number; command: string; cwd: string; ports: number[] }[] = [];
    for (const row of rows) {
      if (row.cwd && isInside(path, row.cwd)) {
        out.push({ pid: row.pid, command: row.command, cwd: row.cwd, ports: row.ports });
      }
    }
    return { processes: out };
  };
}

export const defaultProcessProbe = probeProcesses();

type RawDetailRow = {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  memKB: number;
  lstart: string;
  command: string;
};

function parsePsDetail(out: string): RawDetailRow[] {
  // ps -o pid=,ppid=,user=,%cpu=,rss=,lstart=,command=
  // lstart is "Mon May  8 14:30:00 2026" — five whitespace-separated tokens.
  const rows: RawDetailRow[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({
      pid: parseInt(m[1]!, 10),
      ppid: parseInt(m[2]!, 10),
      user: m[3]!,
      cpu: parseFloat(m[4]!),
      memKB: parseInt(m[5]!, 10),
      lstart: m[6]!,
      command: m[7]!,
    });
  }
  return rows;
}

type DetailDeps = {
  runDetail: (signal?: AbortSignal) => Promise<{
    psDetail: string;
    cwdRaw: string;
    portsRaw: string;
  }>;
};

async function defaultRunDetail(signal?: AbortSignal) {
  const sig = signal ?? new AbortController().signal;
  const [ps, cwd, ports] = await Promise.all([
    spawnCollect("ps", ["-axwwo", "pid=,ppid=,user=,%cpu=,rss=,lstart=,command="], sig),
    spawnCollect("lsof", ["-nP", "-F", "pn", "-a", "-d", "cwd"], sig),
    spawnCollect("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], sig),
  ]);
  return { psDetail: ps.stdout, cwdRaw: cwd.stdout, portsRaw: ports.stdout };
}

export function probeProcessDetail(deps: Partial<DetailDeps> = {}) {
  const run = deps.runDetail ?? defaultRunDetail;
  return async (path: string, signal?: AbortSignal): Promise<ProcessDetail[]> => {
    const { psDetail, cwdRaw, portsRaw } = await run(signal);

    const cwds = new Map<number, string>();
    parseLsofPn(cwdRaw, (pid, name) => cwds.set(pid, name));

    const ports = new Map<number, Set<number>>();
    parseLsofPn(portsRaw, (pid, name) => {
      const p = parsePort(name);
      if (p === null) return;
      let set = ports.get(pid);
      if (!set) {
        set = new Set();
        ports.set(pid, set);
      }
      set.add(p);
    });

    const rows: ProcessDetail[] = [];
    for (const r of parsePsDetail(psDetail)) {
      const cwd = cwds.get(r.pid);
      if (!cwd || !isInside(path, cwd)) continue;
      rows.push({
        pid: r.pid,
        ppid: r.ppid,
        command: r.command,
        cwd,
        user: r.user,
        cpu: r.cpu,
        memMB: Math.round(r.memKB / 1024),
        startedAt: new Date(r.lstart).getTime(),
        ports: ports.has(r.pid) ? [...ports.get(r.pid)!].sort((a, b) => a - b) : [],
      });
    }
    rows.sort((a, b) => a.pid - b.pid);
    return rows;
  };
}

export const defaultProcessDetailProbe = probeProcessDetail();

// Exported for tests.
export const _internal = { parsePs, parseLsofPn, parsePort, parsePsDetail };
