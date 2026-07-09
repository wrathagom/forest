import { existsSync, mkdirSync, copyFileSync, cpSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClaudeConfigDir } from "./config-dirs";

/**
 * Claude Code stores each session transcript at
 * `<configDir>/projects/<slug(cwd)>/<sessionId>.jsonl`, where the slug is the
 * absolute cwd with every non-alphanumeric character replaced by `-`
 * (so `/p/.worktrees/a_b` -> `-p--worktrees-a-b`).
 *
 * `claude --resume <id>` only looks inside the slug dir for the *current* cwd.
 * A session recorded inside a worktree is therefore invisible from the main
 * checkout, and resuming it there fails with
 * "No conversation found with session ID: <id>".
 *
 * When the worktree has been deleted the transcript itself still exists (it
 * lives under the Claude config dir, not the worktree), so we can make the
 * resume work by copying it — and its subagent sidecar dir — into the target
 * cwd's slug dir first.
 *
 * On APFS `copyFileSync` clones, so the duplicate shares blocks copy-on-write
 * and costs practically nothing until one side is appended to.
 */
export function slugForCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function transcriptPathFor(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, "projects", slugForCwd(cwd), `${sessionId}.jsonl`);
}

/**
 * Subagent transcripts sit in a sidecar dir beside the main transcript, at
 * `<slug(cwd)>/<sessionId>/subagents/agent-<agentId>.jsonl`. The main transcript
 * names them only by `agentId` and they are found by path, so they have to
 * travel with it — otherwise a resumed session cannot open its own subagent
 * transcripts. (Forest itself never reads them: the scanner lists files
 * directly in the slug dir and does not recurse.)
 */
export function sidecarDirFor(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, "projects", slugForCwd(cwd), sessionId);
}

/**
 * Copy preserving mtime. The scanner skips a transcript whose mtime has not
 * advanced past the session's stored `last_activity`, so a copy stamped with
 * the current time gets re-ingested and drags `last_activity` forward to the
 * moment of the copy. Bun preserves mtime only incidentally — through APFS
 * clonefile, and only above a file-size threshold — so it has to be explicit.
 */
function copyPreservingMtime(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const { atime, mtime } = statSync(src);
  utimesSync(dest, atime, mtime);
}

/** Bring a session's subagent transcripts across. No-op when it has none. */
function copySidecar(configDir: string, fromCwd: string, toCwd: string, sessionId: string): void {
  const src = sidecarDirFor(configDir, fromCwd, sessionId);
  if (!existsSync(src)) return;
  // `force: false` leaves any already-copied file alone, so this stays safe to
  // re-run against a target that was relocated by an earlier, sidecar-less version.
  cpSync(src, sidecarDirFor(configDir, toCwd, sessionId), {
    recursive: true,
    preserveTimestamps: true,
    force: false,
    errorOnExist: false,
  });
}

export type RelocateDeps = {
  configDirs: ClaudeConfigDir[];
};

export type RelocateInput = {
  sessionId: string;
  /** cwd the session was originally recorded under (usually the gone worktree). */
  fromCwd: string;
  /** cwd we want to resume in (usually the project's main checkout). */
  toCwd: string;
  /** The session's stored profile, i.e. which config dir owns it. */
  profile: string | null;
};

export type RelocateResult =
  /** Source and target are the same directory — nothing to do. */
  | { status: "noop" }
  /** A transcript is already present at the target — resume will find it. */
  | { status: "present"; path: string }
  | { status: "copied"; from: string; to: string };

/**
 * Order config dirs so the session's own profile is tried first. When the
 * profile is unknown (or has no matching dir) we fall back to scanning the
 * rest, mirroring `resolveLaunchEnv`'s behaviour.
 */
function candidateDirs(dirs: ClaudeConfigDir[], profile: string | null): ClaudeConfigDir[] {
  if (!profile) return dirs;
  const owned = dirs.filter((d) => d.profile === profile);
  return [...owned, ...dirs.filter((d) => d.profile !== profile)];
}

/**
 * Make `sessionId` resumable from `toCwd` by ensuring its transcript exists in
 * that cwd's slug dir. Idempotent. Throws if the transcript cannot be located.
 *
 * The source file is left in place: the original slug dir stays a valid record
 * of where the session ran, and `claude` appends to the copy from here on.
 */
export function relocateTranscript(deps: RelocateDeps, input: RelocateInput): RelocateResult {
  if (input.fromCwd === input.toCwd) return { status: "noop" };

  for (const dir of candidateDirs(deps.configDirs, input.profile)) {
    const dest = transcriptPathFor(dir.path, input.toCwd, input.sessionId);
    if (existsSync(dest)) {
      // Self-heal: an earlier relocation may have moved the transcript without
      // its subagent transcripts.
      copySidecar(dir.path, input.fromCwd, input.toCwd, input.sessionId);
      return { status: "present", path: dest };
    }

    const src = transcriptPathFor(dir.path, input.fromCwd, input.sessionId);
    if (existsSync(src)) {
      copyPreservingMtime(src, dest);
      copySidecar(dir.path, input.fromCwd, input.toCwd, input.sessionId);
      return { status: "copied", from: src, to: dest };
    }
  }

  throw new Error(
    `transcript not found for session ${input.sessionId} ` +
      `(looked for ${slugForCwd(input.fromCwd)}/${input.sessionId}.jsonl in ${deps.configDirs.length} config dir(s))`,
  );
}
