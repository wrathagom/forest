import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type DiscoverOpts = { maxDepth?: number };

// Use the first sub-directory under scanRoot as the project's group.
// `~/Projects/Personal/forest` under `~/Projects` → "Personal".
// A repo that is a direct child of scanRoot has no group.
export function inferGroup(scanRoot: string, repoPath: string): string | null {
  const rel = relative(scanRoot, repoPath);
  if (rel === "" || rel.startsWith("..")) return null;
  const parts = rel.split(sep).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[0]!;
}

export async function discoverRepos(root: string, opts: DiscoverOpts = {}): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 4;
  const found: string[] = [];

  function walk(dir: string, depth: number) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isDirectory() && e.name === ".git")) {
      found.push(dir);
      return; // do not recurse below a repo
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(join(dir, e.name), depth + 1);
    }
  }

  walk(root, 0);
  return found.sort();
}
