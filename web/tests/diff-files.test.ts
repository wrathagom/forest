import { test, expect } from "vitest";
import { parseDiffFiles } from "../src/lib/diff-files";

const TWO_FILE = [
  "diff --git a/web/src/a.ts b/web/src/a.ts",
  "index 111..222 100644",
  "--- a/web/src/a.ts",
  "+++ b/web/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " context",
  "-old line",
  "+new line",
  "+another new line",
  "diff --git a/README.md b/README.md",
  "index 333..444 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -0,0 +1 @@",
  "+hello",
].join("\n");

test("splits a unified diff into one group per file", () => {
  const files = parseDiffFiles(TWO_FILE);
  expect(files.map((f) => f.path)).toEqual(["web/src/a.ts", "README.md"]);
});

test("counts added and deleted lines per file, excluding +++/--- markers", () => {
  const files = parseDiffFiles(TWO_FILE);
  expect({ adds: files[0]!.adds, dels: files[0]!.dels }).toEqual({ adds: 2, dels: 1 });
  expect({ adds: files[1]!.adds, dels: files[1]!.dels }).toEqual({ adds: 1, dels: 0 });
});

test("keeps every raw line of a file group, including its diff --git header", () => {
  const files = parseDiffFiles(TWO_FILE);
  expect(files[0]!.lines[0]).toBe("diff --git a/web/src/a.ts b/web/src/a.ts");
  expect(files[0]!.lines).toContain("+new line");
});

test("returns [] for empty or whitespace-only input", () => {
  expect(parseDiffFiles("")).toEqual([]);
  expect(parseDiffFiles("   \n  ")).toEqual([]);
});

test("falls back to a single group when there is no diff --git header", () => {
  const files = parseDiffFiles("@@ -1 +1 @@\n-a\n+b");
  expect(files).toHaveLength(1);
  expect(files[0]!.adds).toBe(1);
  expect(files[0]!.dels).toBe(1);
});

test("uses the diff --git b/ path for a pure rename with no +++ line", () => {
  const rename = [
    "diff --git a/old-name.ts b/new-name.ts",
    "similarity index 100%",
    "rename from old-name.ts",
    "rename to new-name.ts",
  ].join("\n");
  expect(parseDiffFiles(rename)[0]!.path).toBe("new-name.ts");
});

test("uses the diff --git b/ path for a deleted file (+++ /dev/null)", () => {
  const deletion = [
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "index 111..000",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-was here",
  ].join("\n");
  const files = parseDiffFiles(deletion);
  expect(files[0]!.path).toBe("gone.txt");
  expect(files[0]!.dels).toBe(1);
});
