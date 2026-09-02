// server/src/lifecycle/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ForestConfig = {
  start?: string;
  stop?: string;
  health?: string;
  url?: string;
};

/**
 * Read and parse `<projectPath>/forest.yaml`. Tolerant: a missing or malformed
 * file, or one with no recognised string keys, returns null. Only `start`,
 * `stop`, `health`, and `url` (each a string) are read; everything else is
 * ignored.
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
  const cfg: ForestConfig = {};
  for (const key of ["start", "stop", "health", "url"] as const) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") cfg[key] = v.trim();
  }
  if (
    cfg.start === undefined &&
    cfg.stop === undefined &&
    cfg.health === undefined &&
    cfg.url === undefined
  ) {
    return null;
  }
  return cfg;
}
