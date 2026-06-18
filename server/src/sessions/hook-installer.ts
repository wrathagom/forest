import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeConfigDir } from "./config-dirs";

export type InstallInput = {
  dataDir: string;              // forest data dir (e.g. ~/.local/share/forest)
  configDirs: ClaudeConfigDir[]; // Claude config dirs to install hooks into
  port: number;                 // forest port
};

export type InstallResult = {
  shimPath: string;
  settings: Array<{ profile: string; settingsPath: string }>;
};

const FOREST_MARKER = "# forest-ingest hook (managed by forest)";

const MANAGED_HOOKS: ReadonlyArray<readonly [event: string, arg: string, matcher?: string]> = [
  ["PreCompact", "precompact"],
  ["SessionEnd", "sessionend"],
  ["SessionStart", "sessionstart"],
  ["UserPromptSubmit", "userpromptsubmit"],
  ["Stop", "stop"],
  ["Notification", "notification"],
  // Subagent dispatch — keeps the parent session showing `working` (not a stale
  // `waiting` from an earlier Notification) while a Task subagent runs.
  ["PreToolUse", "pretooluse", "Task"],
  // Every tool completion — a session heartbeat. Unmatched, so it also fires the
  // moment you answer an AskUserQuestion (that tool completing), which is otherwise
  // invisible to Forest and leaves the chip falsely `waiting`/`stale`.
  ["PostToolUse", "posttooluse"],
];

function shimContent(port: number, queueDir: string): string {
  return `#!/usr/bin/env bash
${FOREST_MARKER}
EVENT="\${1:-unknown}"
PORT="\${FOREST_PORT:-${port}}"
mkdir -p "${queueDir}"
BODY="$(cat)"
if ! curl -s --max-time 2 -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-Forest-Event: $EVENT" \\
  -H "X-Forest-Pty: \${FOREST_PTY:-}" \\
  --data-binary "$BODY" \\
  "http://127.0.0.1:$PORT/api/agent-sessions/ingest" >/dev/null 2>&1; then
  TS="$(date +%s)"
  printf '%s' "$BODY" > "${queueDir}/$EVENT-$TS-$$.json"
fi
`;
}

function mergeHooksInto(claudeDir: string, shimPath: string): string {
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");
  const settings: Record<string, unknown> = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8") || "{}")
    : {};
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;

  for (const [event, arg, matcher] of MANAGED_HOOKS) {
    const ourCmd = `${shimPath} ${arg}`;
    const groups = hooks[event] ?? [];
    const installed = groups.some((g) => g.hooks.some((h) => h.command === ourCmd));
    if (!installed) {
      if (matcher !== undefined) {
        // matched hooks (e.g. PreToolUse) get their own group so we don't run our
        // command against whatever matcher the user's existing group carries.
        groups.push({ matcher, hooks: [{ type: "command", command: ourCmd }] });
      } else if (groups.length === 0) {
        groups.push({ hooks: [{ type: "command", command: ourCmd }] });
      } else {
        groups[0]!.hooks.push({ type: "command", command: ourCmd });
      }
      hooks[event] = groups;
    }
  }
  settings.hooks = hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}

export function installHooks(input: InstallInput): InstallResult {
  const binDir = join(input.dataDir, "bin");
  const queueDir = join(input.dataDir, "queue");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(queueDir, { recursive: true });
  const shimPath = join(binDir, "forest-ingest");
  writeFileSync(shimPath, shimContent(input.port, queueDir));
  chmodSync(shimPath, 0o755);

  const settings = input.configDirs.map((cfg) => ({
    profile: cfg.profile,
    settingsPath: mergeHooksInto(cfg.path, shimPath),
  }));
  return { shimPath, settings };
}
