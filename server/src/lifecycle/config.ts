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
  return COMMAND_KEYS.some((k) => sec[k] !== undefined);
}

/**
 * The outcome of reading `forest.yaml`, distinguishing a file that failed to
 * parse from one that is simply absent (or valid-but-empty). `parseError` is a
 * human-readable YAML error, set *only* when the file exists but can't be
 * parsed — so the UI can tell "no forest.yaml" apart from "forest.yaml is
 * broken". A missing file, or valid YAML with no recognised keys, is
 * `{ config: null, parseError: null }`.
 */
export type ConfigResult = {
  config: ForestConfig | null;
  parseError: string | null;
};

/**
 * Read and parse `<projectPath>/forest.yaml`. Reads top-level
 * `start`/`stop`/`health`/`url` (each a string) plus an optional `sections` map
 * of the same shape; everything else is ignored. Missing file, malformed YAML,
 * or no recognised content all yield a null `config` — see `parseError` to tell
 * a broken file from an absent one.
 */
export function readConfigResult(projectPath: string): ConfigResult {
  let raw: string;
  try {
    raw = readFileSync(join(projectPath, "forest.yaml"), "utf8");
  } catch {
    return { config: null, parseError: null }; // no file
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    // Present but malformed — surface the YAML error so the UI can prompt a fix
    // (a common cause is an unquoted command value beginning with [, {, > …).
    return { config: null, parseError: err instanceof Error ? err.message : String(err) };
  }
  if (!parsed || typeof parsed !== "object") {
    return { config: null, parseError: "forest.yaml is not a YAML mapping" };
  }
  const obj = parsed as Record<string, unknown>;

  const cfg: ForestConfig = readSection(obj);

  const rawSections = obj.sections;
  if (rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)) {
    const sections: Record<string, LifecycleSection> = {};
    for (const [rawName, value] of Object.entries(rawSections as Record<string, unknown>)) {
      const name = rawName.trim();
      if (name === "") continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const sec = readSection(value as Record<string, unknown>);
      if (hasAnyKey(sec)) sections[name] = sec;
    }
    if (Object.keys(sections).length > 0) cfg.sections = sections;
  }

  if (!hasAnyKey(cfg) && cfg.sections === undefined) return { config: null, parseError: null };
  return { config: cfg, parseError: null };
}

/**
 * Read `forest.yaml` and return just the config (null when absent, malformed,
 * or empty). Callers that need to distinguish a broken file from an absent one
 * should use {@link readConfigResult} instead.
 */
export function readConfig(projectPath: string): ForestConfig | null {
  return readConfigResult(projectPath).config;
}
