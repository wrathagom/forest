import { describe, expect, test } from "bun:test";
import { gitInit, gitCommit, gitClone, type RunGit } from "../src/git";

function makeFakeRunGit() {
  const calls: { args: string[]; cwd: string }[] = [];
  let nextOutcome: { code: number; stderr: string } = { code: 0, stderr: "" };
  const fake: RunGit = async (args, cwd) => {
    calls.push({ args, cwd });
    return { stdout: "", stderr: nextOutcome.stderr, code: nextOutcome.code };
  };
  return {
    fake,
    calls,
    succeed: () => { nextOutcome = { code: 0, stderr: "" }; },
    fail: (msg: string) => { nextOutcome = { code: 1, stderr: msg }; },
  };
}

describe("gitInit", () => {
  test("runs `git init -b main` in cwd", async () => {
    const g = makeFakeRunGit();
    await gitInit("/proj", g.fake);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.args).toEqual(["init", "-b", "main"]);
    expect(g.calls[0]!.cwd).toBe("/proj");
  });

  test("throws with the stderr first line on non-zero exit", async () => {
    const g = makeFakeRunGit();
    g.fail("git init failed: permission denied\nmore detail");
    await expect(gitInit("/proj", g.fake)).rejects.toThrow(/git init failed: permission denied/);
  });
});

describe("gitCommit", () => {
  test("runs add then commit with the supplied message", async () => {
    const g = makeFakeRunGit();
    await gitCommit("/proj", "initial commit", ["README.md"], g.fake);
    expect(g.calls).toHaveLength(2);
    expect(g.calls[0]!.args).toEqual(["add", "README.md"]);
    expect(g.calls[1]!.args).toEqual(["commit", "-m", "initial commit"]);
  });

  test("supports adding multiple paths", async () => {
    const g = makeFakeRunGit();
    await gitCommit("/proj", "init", ["README.md", "package.json"], g.fake);
    expect(g.calls[0]!.args).toEqual(["add", "README.md", "package.json"]);
  });

  test("throws on non-zero exit from commit", async () => {
    const g = makeFakeRunGit();
    g.fail("Author identity unknown");
    await expect(gitCommit("/proj", "initial", ["README.md"], g.fake)).rejects.toThrow(/Author identity unknown/);
  });
});

describe("gitClone", () => {
  test("runs clone <url> <dest>", async () => {
    const g = makeFakeRunGit();
    await gitClone("git@github.com:foo/bar.git", "/dest", g.fake);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.args).toEqual(["clone", "git@github.com:foo/bar.git", "/dest"]);
    expect(typeof g.calls[0]!.cwd).toBe("string");
  });

  test("throws on non-zero exit", async () => {
    const g = makeFakeRunGit();
    g.fail("fatal: repository 'x' not found");
    await expect(gitClone("git@host:x.git", "/dest", g.fake)).rejects.toThrow(/repository 'x' not found/);
  });
});
