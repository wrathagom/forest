type DetectInput = {
  psOutput: string;
  ptyPids: number[];
  agentNames: string[];
};

type ProcRow = { pid: number; ppid: number; comm: string };

function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("PID")) continue;
    const parts = t.split(/\s+/);
    const pid = parseInt(parts[0]!, 10);
    const ppid = parseInt(parts[1]!, 10);
    const comm = parts.slice(2).join(" ");
    if (!Number.isNaN(pid) && !Number.isNaN(ppid)) rows.push({ pid, ppid, comm });
  }
  return rows;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function detectAgentsForPids(input: DetectInput): Map<number, string> {
  const result = new Map<number, string>();
  const rows = parsePs(input.psOutput);
  const childrenOf = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const arr = childrenOf.get(r.ppid) ?? [];
    arr.push(r);
    childrenOf.set(r.ppid, arr);
  }

  // Build a priority map: lower index = higher priority
  const agentPriority = new Map<string, number>();
  for (let i = 0; i < input.agentNames.length; i++) {
    agentPriority.set(input.agentNames[i]!.toLowerCase(), i);
  }

  for (const ptyPid of input.ptyPids) {
    // BFS/DFS to collect all agent matches under this pid, then pick highest priority
    const stack = [ptyPid];
    const seen = new Set<number>();
    const found: Array<{ name: string; priority: number }> = [];

    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const kids = childrenOf.get(cur) ?? [];
      for (const k of kids) {
        const name = basename(k.comm).toLowerCase();
        const priority = agentPriority.get(name);
        if (priority !== undefined) {
          found.push({ name, priority });
        }
        stack.push(k.pid);
      }
    }

    if (found.length > 0) {
      // Pick the agent with the lowest priority index (first in agentNames list)
      found.sort((a, b) => a.priority - b.priority);
      result.set(ptyPid, found[0]!.name);
    }
  }
  return result;
}

export async function runPs(): Promise<string> {
  const proc = Bun.spawn(["ps", "-o", "pid,ppid,comm", "-A"]);
  return await new Response(proc.stdout).text();
}

export class AgentDetector {
  private cache = new Map<number, { agent: string | null; expires: number }>();
  private lastActivity = 0;
  private readonly ttlMs = 5_000;
  private readonly idleAfterMs = 30_000;

  bumpActivity(): void {
    this.lastActivity = Date.now();
  }

  async refresh(opts: { ptyPids: number[]; agentNames: string[] }): Promise<void> {
    if (Date.now() - this.lastActivity > this.idleAfterMs) return; // skip when nobody's looking
    const out = await runPs();
    const detected = detectAgentsForPids({ psOutput: out, ptyPids: opts.ptyPids, agentNames: opts.agentNames });
    const exp = Date.now() + this.ttlMs;
    for (const pid of opts.ptyPids) {
      this.cache.set(pid, { agent: detected.get(pid) ?? null, expires: exp });
    }
  }

  get(pid: number): string | null {
    const e = this.cache.get(pid);
    if (!e || e.expires < Date.now()) return null;
    return e.agent;
  }
}
