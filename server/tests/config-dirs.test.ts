import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverClaudeConfigDirs } from "../src/sessions/config-dirs";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "forest-cfgdirs-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("discoverClaudeConfigDirs", () => {
  test("finds .claude and .claude-* dirs that have projects/ or settings.json", () => {
    mkdirSync(join(home, ".claude", "projects"), { recursive: true });
    mkdirSync(join(home, ".claude-work"), { recursive: true });
    writeFileSync(join(home, ".claude-work", "settings.json"), "{}");
    mkdirSync(join(home, ".claude-personal", "projects"), { recursive: true });
    // excluded: empty dir, and a regular file
    mkdirSync(join(home, ".claude-empty"), { recursive: true });
    writeFileSync(join(home, ".claude-file"), "not a dir");

    const dirs = discoverClaudeConfigDirs(home);
    expect(dirs).toEqual([
      { path: join(home, ".claude"), profile: "default" },
      { path: join(home, ".claude-personal"), profile: "personal" },
      { path: join(home, ".claude-work"), profile: "work" },
    ]);
  });

  test("falls back to ~/.claude when nothing matches", () => {
    const dirs = discoverClaudeConfigDirs(home);
    expect(dirs).toEqual([{ path: join(home, ".claude"), profile: "default" }]);
  });
});
