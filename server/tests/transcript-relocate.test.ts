import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slugForCwd, transcriptPathFor, relocateTranscript } from "../src/sessions/transcript-relocate";
import type { ClaudeConfigDir } from "../src/sessions/config-dirs";

describe("slugForCwd", () => {
  // Pinned against real Claude Code behaviour: every non-alphanumeric char
  // becomes "-", so "/a/b" -> "-a-b" and "/x/-y" -> "-x--y".
  test("replaces slashes with dashes", () => {
    expect(slugForCwd("/Users/u/Projects/forest")).toBe("-Users-u-Projects-forest");
  });

  test("replaces dots and underscores with dashes", () => {
    expect(slugForCwd("/p/.worktrees/my_branch.v2")).toBe("-p--worktrees-my-branch-v2");
  });

  test("preserves existing dashes and digits", () => {
    expect(slugForCwd("/tmp/claude-502/-Users-x")).toBe("-tmp-claude-502--Users-x");
  });
});

describe("transcriptPathFor", () => {
  test("builds <cfg>/projects/<slug>/<sid>.jsonl", () => {
    expect(transcriptPathFor("/home/u/.claude", "/p/main", "sid-1")).toBe(
      "/home/u/.claude/projects/-p-main/sid-1.jsonl",
    );
  });
});

describe("relocateTranscript", () => {
  let root: string;
  let cfgPersonal: ClaudeConfigDir;
  let cfgWork: ClaudeConfigDir;

  const SID = "sid-abc";
  const FROM = "/proj/.worktrees/task-foo";
  const TO = "/proj";

  const seed = (cfg: ClaudeConfigDir, cwd: string, body: string) => {
    const p = transcriptPathFor(cfg.path, cwd, SID);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "relocate-"));
    cfgPersonal = { path: join(root, ".claude-personal"), profile: "personal" };
    cfgWork = { path: join(root, ".claude-work"), profile: "work" };
    mkdirSync(join(cfgPersonal.path, "projects"), { recursive: true });
    mkdirSync(join(cfgWork.path, "projects"), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("copies the transcript into the target cwd's slug dir", () => {
    seed(cfgPersonal, FROM, '{"cwd":"/proj/.worktrees/task-foo"}\n');

    const result = relocateTranscript(
      { configDirs: [cfgPersonal, cfgWork] },
      { sessionId: SID, fromCwd: FROM, toCwd: TO, profile: "personal" },
    );

    expect(result.status).toBe("copied");
    const dest = transcriptPathFor(cfgPersonal.path, TO, SID);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe('{"cwd":"/proj/.worktrees/task-foo"}\n');
    // source is left intact
    expect(existsSync(transcriptPathFor(cfgPersonal.path, FROM, SID))).toBe(true);
  });

  test("is a no-op when fromCwd === toCwd", () => {
    const result = relocateTranscript(
      { configDirs: [cfgPersonal] },
      { sessionId: SID, fromCwd: TO, toCwd: TO, profile: "personal" },
    );
    expect(result.status).toBe("noop");
  });

  test("is idempotent — does not overwrite an existing destination", () => {
    seed(cfgPersonal, FROM, "OLD\n");
    seed(cfgPersonal, TO, "ALREADY-RESUMED\n");

    const result = relocateTranscript(
      { configDirs: [cfgPersonal] },
      { sessionId: SID, fromCwd: FROM, toCwd: TO, profile: "personal" },
    );

    expect(result.status).toBe("present");
    expect(readFileSync(transcriptPathFor(cfgPersonal.path, TO, SID), "utf8")).toBe("ALREADY-RESUMED\n");
  });

  test("uses the config dir matching the session's profile", () => {
    // same session id seeded in BOTH config dirs with different content
    seed(cfgPersonal, FROM, "PERSONAL\n");
    seed(cfgWork, FROM, "WORK\n");

    relocateTranscript(
      { configDirs: [cfgPersonal, cfgWork] },
      { sessionId: SID, fromCwd: FROM, toCwd: TO, profile: "work" },
    );

    expect(readFileSync(transcriptPathFor(cfgWork.path, TO, SID), "utf8")).toBe("WORK\n");
    // personal dir untouched
    expect(existsSync(transcriptPathFor(cfgPersonal.path, TO, SID))).toBe(false);
  });

  test("falls back to searching all config dirs when profile is null", () => {
    seed(cfgWork, FROM, "WORK\n");

    const result = relocateTranscript(
      { configDirs: [cfgPersonal, cfgWork] },
      { sessionId: SID, fromCwd: FROM, toCwd: TO, profile: null },
    );

    expect(result.status).toBe("copied");
    expect(readFileSync(transcriptPathFor(cfgWork.path, TO, SID), "utf8")).toBe("WORK\n");
  });

  test("throws when the source transcript cannot be found anywhere", () => {
    expect(() =>
      relocateTranscript(
        { configDirs: [cfgPersonal, cfgWork] },
        { sessionId: SID, fromCwd: FROM, toCwd: TO, profile: "personal" },
      ),
    ).toThrow(/transcript not found/i);
  });
});
