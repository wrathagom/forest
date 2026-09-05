// server/src/lifecycle/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LifecycleSection = {
  start?: string;
  stop?: string;
  health?: string;
  url?: string;
};

export type ForestConfig = {
  start?: string;
  stop?: string;
  health?: string;
  url?: string;
  sections?: Record<string, LifecycleSection>;
};

const COMMAND_KEYS = ["start", "stop", "health", "url"] as const;

/**
 * Pull the recognised string keys out of one object (top level or a section).
 * Trims, drops empty strings, and drops a `url` whose scheme isn't http(s) (it's
 * rendered as an href). Returns the keys that survived — possibly none.
 */
function readSection(obj: Record<string, unknown>): LifecycleSection {
  const out: LifecycleSection = {};
  for (const key of COMMAND_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  if (out.url !== undefined && !/^https?:\/\//i.test(out.url)) delete out.url;
  return out;
}

function hasAnyKey(sec: LifecycleSection): boolean {
  return sec.start !== undefined || sec.stop !== undefined || sec.health !== undefined || sec.url !== undefined;
}

/**
 * Read and parse `<projectPath>/forest.yaml`. Tolerant: a missing or malformed
 * file, or one with no recognised content, returns null. Reads top-level
 * `start`/`stop`/`health`/`url` (each a string) plus an optional `sections` map
 * of the same shape; everything else is ignored.
 */
export function readConfig(projectPath: string): ForestConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(projectPath, "forest.yaml"), "utf8");
  } catch {
    return null; // no file
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch {
    return null; // malformed
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const cfg: ForestConfig = readSection(obj);

  const rawSections = obj.sections;
  if (rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)) {
    const sections: Record<string, LifecycleSection> = {};
    for (const [name, value] of Object.entries(rawSections as Record<string, unknown>)) {
      if (typeof name !== "string" || name.trim() === "") continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const sec = readSection(value as Record<string, unknown>);
      if (hasAnyKey(sec)) sections[name] = sec;
    }
    if (Object.keys(sections).length > 0) cfg.sections = sections;
  }

  if (!hasAnyKey(cfg) && cfg.sections === undefined) return null;
  return cfg;
}
