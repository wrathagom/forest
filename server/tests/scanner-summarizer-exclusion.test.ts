import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { scanClaudeProjects } from "../src/sessions/scanner";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-scan-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeTranscript(configDir: string, slug: string, sessionId: string, cwd: string): void {
  const dir = join(configDir, "projects", slug);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    type: "user", sessionId, cwd, timestamp: "2026-07-22T00:00:00.000Z",
    uuid: "u1", message: { role: "user", content: "hello" },
  });
  writeFileSync(join(dir, `${sessionId}.jsonl`), line + "\n");
}

describe("scanClaudeProjects excludeCwd", () => {
  test("ingests a normal session", async () => {
    const db = openDb(":memory:");
    const vault = new Vault(db);
    const cfg = join(tmp, "claude");
    writeTranscript(cfg, "proj", "keep-me", "/some/project");
    await scanClaudeProjects({
      db, vault, configDirs: [{ path: cfg, profile: "default" }], projects: [],
    });
    expect(vault.getSession("keep-me")).toBeDefined();
  });

  test("skips transcripts whose cwd is the excluded summarizer dir", async () => {
    const db = openDb(":memory:");
    const vault = new Vault(db);
    const cfg = join(tmp, "claude");
    const summarizerDir = join(tmp, "data", "summarizer");
    writeTranscript(cfg, "summarizer", "skip-me", summarizerDir);
    writeTranscript(cfg, "proj", "keep-me", "/some/project");
    await scanClaudeProjects({
      db, vault, configDirs: [{ path: cfg, profile: "default" }], projects: [],
      excludeCwd: summarizerDir,
    });
    expect(vault.getSession("skip-me")).toBeUndefined();
    expect(vault.getSession("keep-me")).toBeDefined();
  });
});
