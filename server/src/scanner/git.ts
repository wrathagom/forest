import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { GitProbe } from "./types";

const LS_FILES_CAP = 10_000;

function run(cmd: string, args: string[], cwd: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, signal });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", () => resolve({ stdout, stderr, code: -1 }));
    p.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export const probeGit: GitProbe = async (path, signal) => {
  const errors: string[] = [];
  let branch: string | null = null;
  let dirty = false;
  let changed = 0;
  let ahead = 0;
  let behind = 0;
  let lastCommit: { sha: string; message: string; timestamp: number } | null = null;
  let lastEdit: number | null = null;

  const head = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], path, signal);
  if (head.code === 0) {
    const b = head.stdout.trim();
    branch = b === "HEAD" ? null : b;
  } else if (!head.stderr.includes("ambiguous argument 'HEAD'")) {
    errors.push(head.stderr.split("\n")[0] ?? "rev-parse failed");
  } else {
    branch = "main";
  }

  const status = await run("git", ["status", "--porcelain=v1", "-z"], path, signal);
  if (status.code === 0) {
    const entries = status.stdout.split("\0").filter(Boolean);
    changed = entries.length;
    dirty = changed > 0;
  } else {
    errors.push("status failed");
  }

  const upstream = await run("git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"], path, signal);
  if (upstream.code === 0) {
    const m = upstream.stdout.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) {
      ahead = parseInt(m[1]!, 10);
      behind = parseInt(m[2]!, 10);
    }
  }

  const log = await run("git", ["log", "-1", "--format=%H%x00%ct%x00%s"], path, signal);
  if (log.code === 0 && log.stdout.length > 0) {
    const [sha, ts, ...rest] = log.stdout.trim().split("\0");
    if (sha && ts) {
      lastCommit = { sha, timestamp: parseInt(ts, 10) * 1000, message: rest.join("\0") };
    }
  }

  const ls = await run("git", ["ls-files", "-z"], path, signal);
  if (ls.code === 0) {
    const files = ls.stdout.split("\0").filter(Boolean);
    if (files.length === 0 || files.length > LS_FILES_CAP) {
      try {
        lastEdit = statSync(path).mtimeMs;
      } catch {
        lastEdit = null;
      }
    } else {
      let max = 0;
      for (const f of files) {
        try {
          const m = statSync(join(path, f)).mtimeMs;
          if (m > max) max = m;
        } catch {
          // ignore unreadable files
        }
      }
      lastEdit = max || null;
    }
  }

  return { branch, dirty, changed, ahead, behind, lastCommit, lastEdit, errors };
};
