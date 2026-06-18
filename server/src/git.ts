import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { parsePorcelainV1Z, type FileStatus } from "./git-status";

export type RunGit = (args: string[], cwd: string, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultRunGit: RunGit = (args, cwd, signal) =>
  new Promise((resolve) => {
    const p = spawn("git", args, { cwd, signal });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => resolve({ stdout, stderr: stderr || (err as Error).message, code: -1 }));
    p.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });

function firstLine(s: string): string {
  return s.split("\n")[0]!.trim();
}

export async function gitInit(cwd: string, run: RunGit = defaultRunGit): Promise<void> {
  const r = await run(["init", "-b", "main"], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git init exited ${r.code}`);
}

export async function gitCommit(
  cwd: string,
  message: string,
  paths: string[],
  run: RunGit = defaultRunGit,
): Promise<void> {
  const add = await run(["add", ...paths], cwd);
  if (add.code !== 0) throw new Error(firstLine(add.stderr) || `git add exited ${add.code}`);
  const commit = await run(["commit", "-m", message], cwd);
  if (commit.code !== 0) throw new Error(firstLine(commit.stderr) || `git commit exited ${commit.code}`);
}

export async function gitClone(url: string, dest: string, run: RunGit = defaultRunGit): Promise<void> {
  const r = await run(["clone", url, dest], dirname(dest));
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git clone exited ${r.code}`);
}

export type LogCommit = {
  sha: string;
  subject: string;
  author: string;
  timestamp: number;
};

/**
 * Returns up to `limit` commits in reverse chronological order.
 * Starts from `ref` (defaults to HEAD) unless `before` is set, in which case
 * it starts from `before^` (exclusive of `before` itself).
 */
export async function gitLog(
  cwd: string,
  opts: { limit: number; before?: string; ref?: string },
  run: RunGit = defaultRunGit,
): Promise<{ commits: LogCommit[]; hasMore: boolean }> {
  const args = [
    "log",
    `--max-count=${opts.limit + 1}`,
    "--no-color",
    // Each commit is one line; fields within a commit are NUL-separated.
    "--pretty=format:%H%x00%s%x00%an <%ae>%x00%ct",
  ];
  if (opts.before) {
    args.push(`${opts.before}^@`);
  } else {
    args.push(opts.ref ?? "HEAD");
  }
  const r = await run(args, cwd);
  if (r.code !== 0) {
    throw new Error(firstLine(r.stderr) || `git log exited ${r.code}`);
  }
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);
  const all: LogCommit[] = lines.map((line) => {
    const [sha, subject, author, ts] = line.split("\0");
    return {
      sha: sha ?? "",
      subject: subject ?? "",
      author: author ?? "",
      timestamp: Number(ts) * 1000,
    };
  });
  const hasMore = all.length > opts.limit;
  return { commits: hasMore ? all.slice(0, opts.limit) : all, hasMore };
}

export type DiffResult = {
  diff: string;
  status: FileStatus | null;
};

/**
 * Returns the unified diff for a single path: working tree vs HEAD.
 * - Untracked: synthesized with `git diff --no-index /dev/null <abs>`.
 * - Deleted/modified/added: `git diff HEAD -- <relPath>`.
 * - Clean: empty diff, status null.
 *
 * `absPath` must already be validated to live within `cwd`.
 */
export async function gitDiffPath(
  cwd: string,
  relPath: string,
  absPath: string,
  run: RunGit = defaultRunGit,
): Promise<DiffResult> {
  const statusRun = await run(
    ["status", "--porcelain=v1", "-z", "--", relPath],
    cwd,
  );
  if (statusRun.code !== 0) {
    throw new Error(firstLine(statusRun.stderr) || "git status failed");
  }
  const statusMap = parsePorcelainV1Z(statusRun.stdout);
  const status = statusMap.get(relPath) ?? null;

  if (status === null) {
    return { diff: "", status: null };
  }

  if (status === "?") {
    // diff --no-index exits 1 when files differ — that's expected, accept it.
    const r = await run(
      ["diff", "--no-index", "--no-color", "--", "/dev/null", absPath],
      cwd,
    );
    if (r.code !== 0 && r.code !== 1) {
      throw new Error(firstLine(r.stderr) || `git diff exited ${r.code}`);
    }
    return { diff: r.stdout, status: "?" };
  }

  const r = await run(["diff", "HEAD", "--no-color", "--", relPath], cwd);
  if (r.code !== 0) {
    throw new Error(firstLine(r.stderr) || `git diff exited ${r.code}`);
  }
  return { diff: r.stdout, status };
}

export type CommitDetail = {
  sha: string;
  parents: string[];
  author: string;
  timestamp: number;
  message: string;
  diff: string;
};

/**
 * Returns metadata + combined diff for a single commit. Throws if the
 * sha doesn't resolve to a commit (caller should map that to 404).
 */
export async function gitShowCommit(
  cwd: string,
  sha: string,
  run: RunGit = defaultRunGit,
): Promise<CommitDetail> {
  // Validate first so we can surface a clean 404 case.
  const verify = await run(["rev-parse", "--verify", `${sha}^{commit}`], cwd);
  if (verify.code !== 0) {
    const err = new Error("not found");
    (err as Error & { kind: string }).kind = "not-found";
    throw err;
  }
  const fullSha = verify.stdout.trim();

  // Metadata: %H, %P, "%an <%ae>", %ct, then full message %B (potentially
  // multi-line, so it must be the last field — we slice on the 4th newline).
  const meta = await run(
    [
      "show",
      "-s",
      `--format=%H%n%P%n%an <%ae>%n%ct%n%B`,
      fullSha,
    ],
    cwd,
  );
  if (meta.code !== 0) {
    throw new Error(firstLine(meta.stderr) || `git show -s exited ${meta.code}`);
  }
  const lines = meta.stdout.split("\n");
  const [shaLine, parentsLine, authorLine, ctLine] = lines;
  const messageLines = lines.slice(4);
  // Trim trailing empty line(s) git adds.
  while (messageLines.length > 0 && messageLines[messageLines.length - 1] === "") {
    messageLines.pop();
  }

  const diff = await run(
    ["show", fullSha, "--pretty=format:", "--no-color"],
    cwd,
  );
  if (diff.code !== 0) {
    throw new Error(firstLine(diff.stderr) || `git show diff exited ${diff.code}`);
  }
  // git show with --pretty=format: still emits a leading blank line before the diff.
  const diffText = diff.stdout.replace(/^\n/, "");

  return {
    sha: shaLine ?? fullSha,
    parents: (parentsLine ?? "").split(" ").filter(Boolean),
    author: authorLine ?? "",
    timestamp: Number(ctLine) * 1000,
    message: messageLines.join("\n"),
    diff: diffText,
  };
}

export async function gitWorktreeAdd(
  cwd: string,
  dest: string,
  newBranch: string,
  baseBranch: string,
  run: RunGit = defaultRunGit,
): Promise<void> {
  const r = await run(["worktree", "add", dest, "-b", newBranch, baseBranch], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git worktree add exited ${r.code}`);
}

export async function gitWorktreeRemove(
  cwd: string,
  worktreePath: string,
  run: RunGit = defaultRunGit,
): Promise<void> {
  const r = await run(["worktree", "remove", "--force", worktreePath], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git worktree remove exited ${r.code}`);
}

export async function gitDeleteBranch(
  cwd: string,
  branch: string,
  run: RunGit = defaultRunGit,
): Promise<void> {
  const r = await run(["branch", "-D", branch], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git branch -D exited ${r.code}`);
}

export type MergeResult =
  | { ok: true; sha: string }
  | { ok: false; reason: "dirty" | "conflict"; message: string };

/**
 * Merges `branch` into whatever is checked out in `cwd` (the main checkout).
 * - Refuses if the working tree is dirty (`reason: "dirty"`).
 * - On conflict, leaves the merge in progress for the user to resolve in a
 *   terminal (`reason: "conflict"`).
 * - Any other merge failure throws.
 */
export async function gitMerge(
  cwd: string,
  branch: string,
  run: RunGit = defaultRunGit,
): Promise<MergeResult> {
  const status = await run(["status", "--porcelain"], cwd);
  if (status.code !== 0) throw new Error(firstLine(status.stderr) || "git status failed");
  if (status.stdout.trim() !== "") {
    return { ok: false, reason: "dirty", message: "the main checkout has uncommitted changes" };
  }
  const merge = await run(["merge", "--no-ff", "-m", `Merge ${branch}`, branch], cwd);
  if (merge.code === 0) {
    const head = await run(["rev-parse", "HEAD"], cwd);
    return { ok: true, sha: head.stdout.trim() };
  }
  // A merge in progress means a conflict — confirm via MERGE_HEAD.
  const inProgress = await run(["rev-parse", "-q", "--verify", "MERGE_HEAD"], cwd);
  if (inProgress.code === 0) {
    return { ok: false, reason: "conflict", message: firstLine(merge.stderr) || "merge conflict" };
  }
  throw new Error(firstLine(merge.stderr) || `git merge exited ${merge.code}`);
}

/** Unified diff of everything on `branch` since it diverged from `base`. */
export async function gitRangeDiff(
  cwd: string,
  base: string,
  branch: string,
  run: RunGit = defaultRunGit,
): Promise<string> {
  const r = await run(["diff", "--no-color", `${base}...${branch}`], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git diff exited ${r.code}`);
  return r.stdout;
}

export async function gitPush(
  cwd: string,
  branch: string,
  run: RunGit = defaultRunGit,
): Promise<void> {
  const r = await run(["push", "-u", "origin", branch], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git push exited ${r.code}`);
}

/** The current branch name of the checkout at `cwd` (e.g. "main"); "HEAD" when detached. */
export async function gitCurrentBranch(
  cwd: string,
  run: RunGit = defaultRunGit,
): Promise<string> {
  const r = await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git rev-parse exited ${r.code}`);
  return r.stdout.trim();
}

/** True if a local branch named `branch` exists in `cwd`. */
export async function gitBranchExists(
  cwd: string,
  branch: string,
  run: RunGit = defaultRunGit,
): Promise<boolean> {
  const r = await run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
  return r.code === 0;
}

/**
 * Parse `git worktree list --porcelain` into a branch-name -> worktree-path map.
 * Records are blank-line separated; each has a `worktree <path>` line and,
 * when not detached, a `branch refs/heads/<name>` line. The main checkout is
 * itself one of the records.
 */
export function parseWorktreePorcelain(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  let path: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ") && path) {
      const ref = line.slice("branch ".length);
      const name = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref;
      map.set(name, path);
    } else if (line === "") {
      path = null;
    }
  }
  return map;
}

export type BranchInfo = {
  name: string;
  isCurrent: boolean;
  ahead: number;
  behind: number;
  hasWorktree: boolean;
  worktreePath: string | null;
  dirty: boolean | null;
  lastCommit: number;
};

/**
 * Lists every local branch with metadata for the git tab:
 *  - ahead/behind vs the main checkout's current branch (the "base"),
 *  - whether the branch is checked out in a worktree (the main checkout counts),
 *  - dirty/clean for checked-out branches (null when not checked out anywhere).
 * Branches are sorted current-first, then by most recent commit.
 */
export async function gitBranches(
  cwd: string,
  run: RunGit = defaultRunGit,
): Promise<{ base: string; branches: BranchInfo[] }> {
  const base = await gitCurrentBranch(cwd, run);

  const forEachRef = await run(
    [
      "for-each-ref",
      "--format=%(refname:short)%00%(committerdate:unix)%00%(HEAD)",
      "refs/heads",
    ],
    cwd,
  );
  if (forEachRef.code !== 0) {
    throw new Error(firstLine(forEachRef.stderr) || `git for-each-ref exited ${forEachRef.code}`);
  }

  const worktreeList = await run(["worktree", "list", "--porcelain"], cwd);
  if (worktreeList.code !== 0) {
    throw new Error(firstLine(worktreeList.stderr) || `git worktree list exited ${worktreeList.code}`);
  }
  const worktreeByBranch = parseWorktreePorcelain(worktreeList.stdout);

  const rows = forEachRef.stdout.split("\n").filter((l) => l.length > 0);
  const branches: BranchInfo[] = [];
  // Per-branch failures (rev-list, git status) are intentionally tolerated rather
  // than thrown — a single bad branch shouldn't prevent the whole list from loading.
  // Those fields are left at their zero/null defaults when the sub-command fails.
  for (const row of rows) {
    const [name, ts, headMark] = row.split("\0");
    const branchName = name ?? "";
    if (!branchName) continue;
    const worktreePath = worktreeByBranch.get(branchName) ?? null;

    let ahead = 0;
    let behind = 0;
    if (base !== "HEAD" && branchName !== base) {
      const revList = await run(
        ["rev-list", "--left-right", "--count", `${base}...${branchName}`],
        cwd,
      );
      if (revList.code === 0) {
        const [b, a] = revList.stdout.trim().split(/\s+/);
        behind = Number(b) || 0;
        ahead = Number(a) || 0;
      }
    }

    let dirty: boolean | null = null;
    if (worktreePath) {
      const statusResult = await run(["status", "--porcelain"], worktreePath);
      if (statusResult.code === 0) dirty = statusResult.stdout.trim() !== "";
    }

    branches.push({
      name: branchName,
      isCurrent: headMark === "*",
      ahead,
      behind,
      hasWorktree: worktreePath !== null,
      worktreePath,
      dirty,
      lastCommit: Number(ts) * 1000,
    });
  }

  branches.sort((x, y) => {
    if (x.isCurrent !== y.isCurrent) return x.isCurrent ? -1 : 1;
    return y.lastCommit - x.lastCommit;
  });

  return { base, branches };
}
