import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunGit, gitBranches, parseWorktreePorcelain } from "../src/git";

async function git(args: string[], cwd: string) {
  const r = await defaultRunGit(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

let repo: string;
let worktree: string;

beforeAll(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "forest-branches-")));
  worktree = realpathSync(mkdtempSync(join(tmpdir(), "forest-branches-wt-")));
  await git(["init", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "Test User"], repo);
  await git(["config", "commit.gpgsign", "false"], repo);

  writeFileSync(join(repo, "a.txt"), "one\n");
  await git(["add", "a.txt"], repo);
  await git(["commit", "-m", "commit one"], repo);

  // `stale` points at commit one — it will be 1 behind main.
  await git(["branch", "stale"], repo);

  writeFileSync(join(repo, "a.txt"), "two\n");
  await git(["add", "a.txt"], repo);
  await git(["commit", "-m", "commit two"], repo);

  // `feature` branches from commit two, gets its own worktree + a commit.
  await git(["branch", "feature"], repo);
  await git(["worktree", "add", worktree, "feature"], repo);
  writeFileSync(join(worktree, "b.txt"), "feature work\n");
  await git(["add", "b.txt"], worktree);
  await git(["commit", "-m", "commit three"], worktree);

  // Leave the feature worktree dirty.
  writeFileSync(join(worktree, "a.txt"), "dirty\n");
});

afterAll(() => {
  rmSync(worktree, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("parseWorktreePorcelain", () => {
  test("maps branch names to paths for a main checkout and a linked worktree", () => {
    const porcelain = [
      "worktree /home/user/project",
      "HEAD abc1234abc1234abc1234abc1234abc1234abc1234",
      "branch refs/heads/main",
      "",
      "worktree /home/user/project/.worktrees/feature",
      "HEAD def5678def5678def5678def5678def5678def5678",
      "branch refs/heads/feature",
      "",
    ].join("\n");

    const result = parseWorktreePorcelain(porcelain);
    expect(result.size).toBe(2);
    expect(result.get("main")).toBe("/home/user/project");
    expect(result.get("feature")).toBe("/home/user/project/.worktrees/feature");
  });

  test("skips detached-HEAD records (no branch line)", () => {
    const porcelain = [
      "worktree /home/user/project",
      "HEAD abc1234abc1234abc1234abc1234abc1234abc1234",
      "branch refs/heads/main",
      "",
      "worktree /home/user/project/.worktrees/detached",
      "HEAD def5678def5678def5678def5678def5678def5678",
      "detached",
      "",
    ].join("\n");

    const result = parseWorktreePorcelain(porcelain);
    expect(result.size).toBe(1);
    expect(result.get("main")).toBe("/home/user/project");
  });

  test("returns an empty map for an empty string", () => {
    const result = parseWorktreePorcelain("");
    expect(result.size).toBe(0);
  });
});

describe("gitBranches", () => {
  test("reports base, ahead/behind, worktree, and dirty per branch", async () => {
    const { base, branches } = await gitBranches(repo);
    expect(base).toBe("main");

    const byName = new Map(branches.map((b) => [b.name, b]));
    expect([...byName.keys()].sort()).toEqual(["feature", "main", "stale"]);

    const main = byName.get("main")!;
    expect(main.isCurrent).toBe(true);
    expect(main.ahead).toBe(0);
    expect(main.behind).toBe(0);
    expect(main.hasWorktree).toBe(true);
    expect(main.worktreePath).toBe(repo);
    expect(main.dirty).toBe(false);

    const feature = byName.get("feature")!;
    expect(feature.isCurrent).toBe(false);
    expect(feature.ahead).toBe(1);
    expect(feature.behind).toBe(0);
    expect(feature.hasWorktree).toBe(true);
    expect(feature.worktreePath).toBe(worktree);
    expect(feature.dirty).toBe(true);

    const stale = byName.get("stale")!;
    expect(stale.ahead).toBe(0);
    expect(stale.behind).toBe(1);
    expect(stale.hasWorktree).toBe(false);
    expect(stale.worktreePath).toBeNull();
    expect(stale.dirty).toBeNull();
  });

  test("sorts the current branch first", async () => {
    const { branches } = await gitBranches(repo);
    expect(branches[0]!.name).toBe("main");
  });
});
