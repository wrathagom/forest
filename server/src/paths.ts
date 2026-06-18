import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "forest");
  return join(homedir(), ".local", "share", "forest");
}

export function dbPath(): string {
  return join(dataDir(), "forest.db");
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}
