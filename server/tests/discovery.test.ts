import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRepos, inferGroup } from "../src/discovery";

describe("inferGroup", () => {
  test("returns the first sub-directory under scan root", () => {
    expect(inferGroup("/root", "/root/Personal/forest")).toBe("Personal");
    expect(inferGroup("/root", "/root/Work/api")).toBe("Work");
    expect(inferGroup("/root", "/root/A/B/C/repo")).toBe("A");
  });
  test("returns null for direct children of scan root", () => {
    expect(inferGroup("/root", "/root/forest")).toBeNull();
  });
  test("returns null for the scan root itself", () => {
    expect(inferGroup("/root", "/root")).toBeNull();
  });
  test("returns null for paths outside the scan root", () => {
    expect(inferGroup("/root", "/elsewhere/forest")).toBeNull();
  });
});

function tree(root: string, paths: string[]) {
  for (const p of paths) mkdirSync(join(root, p), { recursive: true });
}

describe("discoverRepos", () => {
  test("finds .git directories up to maxdepth", async () => {
    const root = mkdtempSync(join(tmpdir(), "forest-disc-"));
    tree(root, ["a/.git", "b/inner/.git", "c/x/y/.git"]);
    const found = await discoverRepos(root, { maxDepth: 4 });
    const names = found.map((p) => p.replace(root + "/", "")).sort();
    expect(names).toEqual(["a", "b/inner", "c/x/y"]);
  });

  test("respects a shallower maxdepth", async () => {
    const root = mkdtempSync(join(tmpdir(), "forest-disc-"));
    tree(root, ["a/.git", "b/inner/.git", "c/x/y/.git"]);
    const found = await discoverRepos(root, { maxDepth: 1 });
    expect(found.map((p) => p.replace(root + "/", ""))).toEqual(["a"]);
  });

  test("skips inside .git itself", async () => {
    const root = mkdtempSync(join(tmpdir(), "forest-disc-"));
    tree(root, ["a/.git/objects/pack"]);
    const found = await discoverRepos(root, { maxDepth: 4 });
    expect(found.map((p) => p.replace(root + "/", ""))).toEqual(["a"]);
  });
});
