import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpRepo, gitCommit } from "./helpers/tmpRepo";
import { probeGit } from "../src/scanner/git";

describe("probeGit", () => {
  test("returns clean state with branch + last commit on a fresh repo", async () => {
    const dir = makeTmpRepo();
    gitCommit(dir, "README.md", "hi", "first");
    const out = await probeGit(dir, new AbortController().signal);
    expect(out.branch).toBe("main");
    expect(out.dirty).toBe(false);
    expect(out.changed).toBe(0);
    expect(out.lastCommit?.message).toBe("first");
    expect(typeof out.lastEdit).toBe("number");
  });

  test("flags dirty + counts changes", async () => {
    const dir = makeTmpRepo();
    gitCommit(dir, "a.txt", "1", "init");
    writeFileSync(join(dir, "a.txt"), "2");
    writeFileSync(join(dir, "b.txt"), "new");
    const out = await probeGit(dir, new AbortController().signal);
    expect(out.dirty).toBe(true);
    expect(out.changed).toBe(2);
  });

  test("returns null lastCommit on a repo with no commits", async () => {
    const dir = makeTmpRepo();
    const out = await probeGit(dir, new AbortController().signal);
    expect(out.lastCommit).toBeNull();
    expect(out.branch).toBe("main");
  });

  test("ahead/behind are 0 when there is no upstream", async () => {
    const dir = makeTmpRepo();
    gitCommit(dir, "a.txt", "1", "init");
    const out = await probeGit(dir, new AbortController().signal);
    expect(out.ahead).toBe(0);
    expect(out.behind).toBe(0);
  });
});
