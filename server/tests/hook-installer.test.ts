import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installHooks } from "../src/sessions/hook-installer";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "forest-hooks-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("installHooks", () => {
  test("creates the bash shim with executable bit", () => {
    installHooks({ dataDir: tmp, configDirs: [{ path: join(tmp, "claude"), profile: "default" }], port: 52810 });
    const shim = join(tmp, "bin", "forest-ingest");
    expect(existsSync(shim)).toBe(true);
    expect(statSync(shim).mode & 0o111).not.toBe(0);
  });

  test("writes settings.json with PreCompact + SessionEnd entries", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    expect(settings.hooks?.PreCompact).toHaveLength(1);
    expect(settings.hooks?.SessionEnd).toHaveLength(1);
    const cmd = settings.hooks.PreCompact[0].hooks[0].command as string;
    expect(cmd).toContain("forest-ingest");
    expect(cmd).toContain("precompact");
  });

  test("preserves user's existing hook entries", () => {
    const claudeDir = join(tmp, "claude");
    require("node:fs").mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreCompact: [{ hooks: [{ type: "command", command: "/usr/local/bin/my-existing-hook" }] }],
        },
      }),
    );
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    const cmds = settings.hooks.PreCompact[0].hooks.map((h: { command: string }) => h.command);
    expect(cmds).toContain("/usr/local/bin/my-existing-hook");
    expect(cmds.some((c: string) => c.includes("forest-ingest"))).toBe(true);
  });

  test("is idempotent: second run does not duplicate forest entries", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    const forestCmds = (settings.hooks.PreCompact[0].hooks as Array<{ command: string }>).filter((h) =>
      h.command.includes("forest-ingest"),
    );
    expect(forestCmds).toHaveLength(1);
  });

  test("installs SessionStart/UserPromptSubmit/Stop/Notification hooks too", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    for (const ev of ["SessionStart", "UserPromptSubmit", "Stop", "Notification"]) {
      const cmds = (settings.hooks[ev] as Array<{ hooks: Array<{ command: string }> }>).flatMap((g) =>
        g.hooks.map((h) => h.command),
      );
      expect(cmds.some((c: string) => c.includes("forest-ingest"))).toBe(true);
    }
  });

  test("installs a PreToolUse hook scoped to the Task matcher", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    const group = (settings.hooks.PreToolUse as Array<{ matcher?: string; hooks: Array<{ command: string }> }>).find(
      (g) => g.hooks.some((h) => h.command.includes("forest-ingest")),
    );
    expect(group?.matcher).toBe("Task");
    expect(group?.hooks[0]?.command).toContain("pretooluse");
  });

  test("PreToolUse forest group is added alongside the user's existing PreToolUse groups", () => {
    const claudeDir = join(tmp, "claude");
    require("node:fs").mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/lint" }] }] },
      }),
    );
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    const groups = settings.hooks.PreToolUse as Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.matcher === "Bash")?.hooks[0]?.command).toBe("/usr/local/bin/lint");
    expect(groups.find((g) => g.matcher === "Task")?.hooks[0]?.command).toContain("forest-ingest");
  });

  test("the shim forwards the X-Forest-Pty header", () => {
    installHooks({ dataDir: tmp, configDirs: [{ path: join(tmp, "claude"), profile: "default" }], port: 52810 });
    const shim = readFileSync(join(tmp, "bin", "forest-ingest"), "utf8");
    expect(shim).toContain("X-Forest-Pty:");
    expect(shim).toContain("FOREST_PTY");
  });

  test("the shim's curl is bounded by --max-time so it cannot hang a tool call", () => {
    installHooks({ dataDir: tmp, configDirs: [{ path: join(tmp, "claude"), profile: "default" }], port: 52810 });
    const shim = readFileSync(join(tmp, "bin", "forest-ingest"), "utf8");
    expect(shim).toContain("--max-time");
  });

  test("installs an unmatched PostToolUse hook as a session heartbeat", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    const group = (settings.hooks.PostToolUse as Array<{ matcher?: string; hooks: Array<{ command: string }> }>).find(
      (g) => g.hooks.some((h) => h.command.includes("forest-ingest")),
    );
    expect(group?.matcher).toBeUndefined();
    expect(group?.hooks.find((h) => h.command.includes("forest-ingest"))?.command).toContain("posttooluse");
  });

  test("is idempotent across all managed events", () => {
    const claudeDir = join(tmp, "claude");
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    installHooks({ dataDir: tmp, configDirs: [{ path: claudeDir, profile: "default" }], port: 52810 });
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    for (const ev of ["PreCompact", "SessionEnd", "SessionStart", "UserPromptSubmit", "Stop", "Notification", "PreToolUse", "PostToolUse"]) {
      const forestCmds = (settings.hooks[ev] as Array<{ hooks: Array<{ command: string }> }>)
        .flatMap((g) => g.hooks)
        .filter((h) => h.command.includes("forest-ingest"));
      expect(forestCmds).toHaveLength(1);
    }
  });

  test("installs the hook block into every config dir", () => {
    const a = join(tmp, "claude");
    const b = join(tmp, "claude-work");
    installHooks({ dataDir: tmp, configDirs: [{ path: a, profile: "default" }, { path: b, profile: "work" }], port: 52810 });
    for (const dir of [a, b]) {
      const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
      const cmds = (settings.hooks.PreCompact as Array<{ hooks: Array<{ command: string }> }>)
        .flatMap((g) => g.hooks).map((h) => h.command);
      expect(cmds.some((c: string) => c.includes("forest-ingest"))).toBe(true);
    }
  });
});
