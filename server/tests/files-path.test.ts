import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectPath } from "../src/files/path";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forest-path-"));
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(join(root, "sub", "file.txt"), "hi");
  return root;
}

describe("resolveProjectPath", () => {
  test("accepts a simple relative path", () => {
    const root = makeRoot();
    expect(resolveProjectPath(root, "sub/file.txt")).toBe(join(root, "sub/file.txt"));
  });

  test("rejects absolute paths", () => {
    const root = makeRoot();
    expect(resolveProjectPath(root, "/etc/passwd")).toBeNull();
  });

  test("rejects paths with .. that escape the root", () => {
    const root = makeRoot();
    expect(resolveProjectPath(root, "../escape")).toBeNull();
    expect(resolveProjectPath(root, "sub/../../escape")).toBeNull();
  });

  test("accepts paths with .. that stay inside", () => {
    const root = makeRoot();
    expect(resolveProjectPath(root, "sub/../sub/file.txt")).toBe(join(root, "sub/file.txt"));
  });

  test("rejects symlinks pointing outside the root", () => {
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), "forest-outside-"));
    writeFileSync(join(outside, "secret"), "leak");
    symlinkSync(join(outside, "secret"), join(root, "link-out"));
    expect(resolveProjectPath(root, "link-out")).toBeNull();
  });

  test("accepts symlinks pointing inside the root", () => {
    const root = makeRoot();
    symlinkSync(join(root, "sub/file.txt"), join(root, "link-in"));
    expect(resolveProjectPath(root, "link-in")).toBe(join(root, "link-in"));
  });

  test("rejects non-existent paths whose parent is a symlink to outside", () => {
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), "forest-outside-dir-"));
    symlinkSync(outside, join(root, "escape-dir"));
    // newfile.txt does not exist; escape-dir is a symlink to outside.
    expect(resolveProjectPath(root, "escape-dir/newfile.txt")).toBeNull();
  });

  test("rejects empty path", () => {
    const root = makeRoot();
    expect(resolveProjectPath(root, "")).toBeNull();
  });
});
