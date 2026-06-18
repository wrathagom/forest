import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Vault } from "./vault";
import type { ClaudeConfigDir } from "./config-dirs";

export type LogFn = (level: "warn" | "debug", msg: string, fields?: Record<string, unknown>) => void;

export type ResolverDeps = {
  vault: Vault;
  configDirs: () => ClaudeConfigDir[];
  /** Injectable for tests. Defaults to spawning `multi-agent-profiles resolve <cwd>`. */
  resolveByCwd?: (cwd: string) => string | null;
  /** Injectable for tests. Defaults to `process.env`. Only consulted by the default `resolveByCwd`. */
  spawnEnv?: Record<string, string | undefined>;
  log?: LogFn;
};

export type ResolveInput = {
  agent?: string;
  cwd: string;
  args: string[];
};

function parseResumeSid(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--resume" && i + 1 < args.length) return args[i + 1]!;
    if (a.startsWith("--resume=")) return a.slice("--resume=".length);
  }
  return null;
}

function findByProfile(dirs: ClaudeConfigDir[], profile: string): ClaudeConfigDir | undefined {
  return dirs.find((d) => d.profile === profile);
}

// Module-scoped memo: which executable path worked last? Reset to null on miss.
let cachedExe: string | null = null;

function defaultResolveByCwd(cwd: string, env: Record<string, string | undefined>): string | null {
  const tryExe = (exe: string): string | null => {
    try {
      const out = spawnSync(exe, ["resolve", cwd], {
        env: env as NodeJS.ProcessEnv,
        timeout: 1000,
        encoding: "utf8",
      });
      if (out.error || out.status !== 0) return null;
      const trimmed = (out.stdout ?? "").trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  };

  if (cachedExe) {
    const result = tryExe(cachedExe);
    if (result !== null) return result;
    // executable may have moved between launches — fall through to re-discover
    cachedExe = null;
  }

  // First-choice: PATH lookup
  const onPath = tryExe("multi-agent-profiles");
  if (onPath !== null) {
    cachedExe = "multi-agent-profiles";
    return onPath;
  }

  // Fallback: ~/.local/bin
  const home = env.HOME;
  if (home) {
    const fallback = join(home, ".local", "bin", "multi-agent-profiles");
    const r = tryExe(fallback);
    if (r !== null) {
      cachedExe = fallback;
      return r;
    }
  }

  return null;
}

export function resolveLaunchEnv(deps: ResolverDeps, input: ResolveInput): Record<string, string> {
  if (input.agent !== "claude") return {};
  const dirs = deps.configDirs();

  // 1. Resume case: prefer the session's stored profile.
  const sid = parseResumeSid(input.args);
  if (sid) {
    const sess = deps.vault.getSession(sid);
    if (sess?.profile) {
      const dir = findByProfile(dirs, sess.profile);
      if (dir) return { CLAUDE_CONFIG_DIR: dir.path };
      deps.log?.("warn", `claude resume: vault profile "${sess.profile}" has no matching config dir; falling back to cwd resolution`, { sid });
      // fall through
    }
  }

  // 2. cwd case.
  const resolveByCwd = deps.resolveByCwd ?? ((cwd) => defaultResolveByCwd(cwd, deps.spawnEnv ?? process.env));
  const profile = resolveByCwd(input.cwd);
  if (!profile) {
    deps.log?.("debug", "claude profile not resolved", { cwd: input.cwd });
    return {};
  }
  const dir = findByProfile(dirs, profile);
  if (!dir) {
    deps.log?.("warn", `multi-agent-profiles resolved profile "${profile}" but no matching Claude config dir is detected`, { cwd: input.cwd, profile });
    return {};
  }
  return { CLAUDE_CONFIG_DIR: dir.path };
}
