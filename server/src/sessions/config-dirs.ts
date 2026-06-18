import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type ClaudeConfigDir = { path: string; profile: string };

function looksLikeConfigDir(dir: string): boolean {
  if (existsSync(join(dir, "settings.json"))) return true;
  const proj = join(dir, "projects");
  return existsSync(proj) && statSync(proj).isDirectory();
}

function profileFor(name: string): string {
  return name === ".claude" ? "default" : name.slice(".claude-".length);
}

/**
 * Glob $HOME for `.claude` and `.claude-<name>` directories that are actually
 * in use (have a `projects/` subdir or a `settings.json`). Returns them sorted
 * by profile name. If none match, falls back to `[~/.claude -> "default"]`.
 */
export function discoverClaudeConfigDirs(home: string): ClaudeConfigDir[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(home, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const out: ClaudeConfigDir[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name !== ".claude" && !e.name.startsWith(".claude-")) continue;
    const path = join(home, e.name);
    if (!looksLikeConfigDir(path)) continue;
    out.push({ path, profile: profileFor(e.name) });
  }
  out.sort((a, b) => a.profile.localeCompare(b.profile));
  if (out.length === 0) return [{ path: join(home, ".claude"), profile: "default" }];
  return out;
}
