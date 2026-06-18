import { describe, expect, test } from "bun:test";
import type { RunGit } from "../src/git";
import { gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch } from "../src/git";

/** A RunGit fake that records calls and returns canned results per call index. */
function fakeGit(results: Array<{ stdout?: string; stderr?: string; code: number }>) {
  const calls: string[][] = [];
  let i = 0;
  const run: RunGit = async (args) => {
    calls.push(args);
    const r = results[i++] ?? { code: 0 };
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code };
  };
  return { run, calls };
}

describe("gitWorktreeAdd", () => {
  test("runs `worktree add <dest> -b <branch> <base>`", async () => {
    const { run, calls } = fakeGit([{ code: 0 }]);
    await gitWorktreeAdd("/repo", "/repo/.worktrees/go", "task/go", "main", run);
    expect(calls[0]).toEqual(["worktree", "add", "/repo/.worktrees/go", "-b", "task/go", "main"]);
  });
  test("throws on non-zero exit", async () => {
    const { run } = fakeGit([{ code: 1, stderr: "fatal: branch exists\n" }]);
    expect(gitWorktreeAdd("/repo", "/d", "task/go", "main", run)).rejects.toThrow("fatal: branch exists");
  });
});

describe("gitWorktreeRemove", () => {
  test("runs `worktree remove --force <path>`", async () => {
    const { run, calls } = fakeGit([{ code: 0 }]);
    await gitWorktreeRemove("/repo", "/repo/.worktrees/go", run);
    expect(calls[0]).toEqual(["worktree", "remove", "--force", "/repo/.worktrees/go"]);
  });
});

describe("gitDeleteBranch", () => {
  test("runs `branch -D <branch>`", async () => {
    const { run, calls } = fakeGit([{ code: 0 }]);
    await gitDeleteBranch("/repo", "task/go", run);
    expect(calls[0]).toEqual(["branch", "-D", "task/go"]);
  });
});

import { gitMerge, gitRangeDiff } from "../src/git";

describe("gitMerge", () => {
  test("dirty working tree → {ok:false, reason:'dirty'}, no merge attempted", async () => {
    const { run, calls } = fakeGit([{ code: 0, stdout: " M file.ts\n" }]);
    const r = await gitMerge("/repo", "task/go", run);
    expect(r).toEqual({ ok: false, reason: "dirty", message: expect.any(String) });
    expect(calls.length).toBe(1); // status only — never ran `merge`
  });
  test("clean + successful merge → {ok:true, sha}", async () => {
    const { run, calls } = fakeGit([
      { code: 0, stdout: "" },              // status --porcelain (clean)
      { code: 0 },                          // merge
      { code: 0, stdout: "abc123\n" },      // rev-parse HEAD
    ]);
    const r = await gitMerge("/repo", "task/go", run);
    expect(r).toEqual({ ok: true, sha: "abc123" });
    expect(calls[1]).toEqual(["merge", "--no-ff", "-m", "Merge task/go", "task/go"]);
  });
  test("merge conflict → {ok:false, reason:'conflict'}, merge left in progress", async () => {
    const { run } = fakeGit([
      { code: 0, stdout: "" },                       // status (clean)
      { code: 1, stderr: "CONFLICT (content)\n" },   // merge fails
      { code: 0, stdout: "deadbeef\n" },             // rev-parse MERGE_HEAD succeeds
    ]);
    const r = await gitMerge("/repo", "task/go", run);
    expect(r).toEqual({ ok: false, reason: "conflict", message: expect.any(String) });
  });
  test("non-conflict merge failure throws", async () => {
    const { run } = fakeGit([
      { code: 0, stdout: "" },                        // status (clean)
      { code: 1, stderr: "fatal: not a valid object\n" }, // merge fails
      { code: 1 },                                    // rev-parse MERGE_HEAD fails
    ]);
    expect(gitMerge("/repo", "task/go", run)).rejects.toThrow("not a valid object");
  });
});

describe("gitRangeDiff", () => {
  test("runs `diff <base>...<branch>` and returns stdout", async () => {
    const { run, calls } = fakeGit([{ code: 0, stdout: "diff --git a/x b/x\n" }]);
    const diff = await gitRangeDiff("/repo", "main", "task/go", run);
    expect(calls[0]).toEqual(["diff", "--no-color", "main...task/go"]);
    expect(diff).toBe("diff --git a/x b/x\n");
  });
});

import { gitCurrentBranch, gitBranchExists } from "../src/git";

describe("gitCurrentBranch", () => {
  test("returns the trimmed branch name", async () => {
    const { run, calls } = fakeGit([{ code: 0, stdout: "main\n" }]);
    expect(await gitCurrentBranch("/repo", run)).toBe("main");
    expect(calls[0]).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
  });
  test("throws on non-zero exit", async () => {
    const { run } = fakeGit([{ code: 128, stderr: "fatal: not a git repository\n" }]);
    expect(gitCurrentBranch("/repo", run)).rejects.toThrow("not a git repository");
  });
});

describe("gitBranchExists", () => {
  test("true when rev-parse --verify succeeds", async () => {
    const { run, calls } = fakeGit([{ code: 0, stdout: "abc\n" }]);
    expect(await gitBranchExists("/repo", "task/go", run)).toBe(true);
    expect(calls[0]).toEqual(["rev-parse", "--verify", "--quiet", "refs/heads/task/go"]);
  });
  test("false when rev-parse --verify fails", async () => {
    const { run } = fakeGit([{ code: 1 }]);
    expect(await gitBranchExists("/repo", "task/go", run)).toBe(false);
  });
});

import { gitPush } from "../src/git";

describe("gitPush", () => {
  test("runs `push -u origin <branch>`", async () => {
    const { run, calls } = fakeGit([{ code: 0 }]);
    await gitPush("/repo", "task/go", run);
    expect(calls[0]).toEqual(["push", "-u", "origin", "task/go"]);
  });
  test("throws on non-zero exit", async () => {
    const { run } = fakeGit([{ code: 1, stderr: "fatal: no remote\n" }]);
    expect(gitPush("/repo", "task/go", run)).rejects.toThrow("fatal: no remote");
  });
});
