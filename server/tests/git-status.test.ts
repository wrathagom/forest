import { describe, expect, test } from "bun:test";
import { parsePorcelainV1Z, type FileStatus } from "../src/git-status";

describe("parsePorcelainV1Z", () => {
  test("returns empty map for empty input", () => {
    expect(parsePorcelainV1Z("")).toEqual(new Map());
  });

  test("parses untracked files (??)", () => {
    const m = parsePorcelainV1Z("?? notes.md\0");
    expect(m.get("notes.md")).toBe("?");
  });

  test("parses modified files (working tree change)", () => {
    const m = parsePorcelainV1Z(" M src/main.ts\0");
    expect(m.get("src/main.ts")).toBe("M");
  });

  test("parses staged-modified files (MM)", () => {
    const m = parsePorcelainV1Z("MM src/main.ts\0");
    expect(m.get("src/main.ts")).toBe("M");
  });

  test("parses added/staged files (A )", () => {
    const m = parsePorcelainV1Z("A  server/new.ts\0");
    expect(m.get("server/new.ts")).toBe("A");
  });

  test("treats added-then-modified as A", () => {
    const m = parsePorcelainV1Z("AM server/new.ts\0");
    expect(m.get("server/new.ts")).toBe("A");
  });

  test("parses deleted files (working tree)", () => {
    const m = parsePorcelainV1Z(" D removed.ts\0");
    expect(m.get("removed.ts")).toBe("D");
  });

  test("parses staged-deleted files (D )", () => {
    const m = parsePorcelainV1Z("D  removed.ts\0");
    expect(m.get("removed.ts")).toBe("D");
  });

  test("parses renames using the destination path and consumes from-path token", () => {
    // git -z rename format: "R  <to>\0<from>\0"
    const m = parsePorcelainV1Z("R  newname.ts\0oldname.ts\0");
    expect(m.size).toBe(1);
    expect(m.get("newname.ts")).toBe("R");
    expect(m.has("oldname.ts")).toBe(false);
  });

  test("handles multiple entries including a rename", () => {
    const stdout = " M a.ts\0?? b.ts\0R  new.ts\0old.ts\0A  c.ts\0";
    const m = parsePorcelainV1Z(stdout);
    expect(m.size).toBe(4);
    expect(m.get("a.ts")).toBe("M");
    expect(m.get("b.ts")).toBe("?");
    expect(m.get("new.ts")).toBe("R");
    expect(m.get("c.ts")).toBe("A");
  });

  test("ignores trailing empty token from final NUL", () => {
    const m = parsePorcelainV1Z(" M a\0\0");
    expect(m.size).toBe(1);
  });

  test("type satisfies FileStatus union", () => {
    const m = parsePorcelainV1Z(" M x\0");
    const v: FileStatus | undefined = m.get("x");
    expect(v).toBe("M");
  });
});
