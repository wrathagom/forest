# Codex Session Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish Claude vs Codex terminals visually and surface live/recent Codex sessions in the session bar.

**Architecture:** Add a first-class `agent` field to the in-memory live-session model, then feed it from a new `CodexSessionScanner` that polls `~/.codex/sessions/**` every 3s (mirroring the existing `AgentDetector` loop), correlating rollouts to live Codex PTYs by cwd. No vault/DB changes, no Codex transcript reader — the scanner writes only to the in-memory `LiveAgentSessions` store. The web side reads the new `agent` field and renders a per-agent emoji on tabs and session-bar chips.

**Tech Stack:** Bun + TypeScript server (`bun:test`), SolidJS web (Vitest). Existing helpers reused: `classifyCwd` (`server/src/sessions/scanner.ts`), `SessionRegistry`, `AgentDetector`, `LiveAgentSessions`.

**Spec:** `docs/superpowers/specs/2026-08-12-codex-session-support-design.md`

---

## File Structure

**Server:**
- Modify `server/src/sessions/live.ts` — add `AgentKind` + `agent` field to `LiveEntry`; set `agent:"claude"` on Claude write paths; add `applyCodexScan()`.
- Create `server/src/sessions/codex-scanner.ts` — `parseCodexRollout()` (pure), `buildCodexEntry()` (pure), `scanCodexSessions()` (fs walk).
- Modify `server/src/sessions/registry.ts` — add `list()` to enumerate all live PTYs.
- Modify `server/src/index.ts` — wire the 3s Codex scan loop.
- Create `server/tests/codex-scanner.test.ts`, `server/tests/live-codex.test.ts`.

**Web:**
- Create `web/src/lib/agents.ts` — shared emoji map + `agentIcon()`.
- Modify `web/src/api.ts` — add `agent` to `LiveSessionRow`.
- Modify `web/src/components/SessionBar.tsx` — render agent emoji per chip.
- Modify `web/src/components/TabStrip.tsx` — per-agent glyph instead of generic `🤖`.
- Create `web/tests/agents.test.ts`.

**Test commands:**
- Server: `cd server && bun test tests/<file>.test.ts`
- Web: `cd web && bun run test <file>` (Vitest) — or full `cd web && bun run test`
- Web build/typecheck: `cd web && bun run build`

---

## Task 1: Add `agent` field to the live-session model

**Files:**
- Modify: `server/src/sessions/live.ts`
- Test: `server/tests/live-codex.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/live-codex.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { LiveAgentSessions } from "../src/sessions/live";

describe("LiveAgentSessions agent field", () => {
  test("hook events default to agent 'claude'", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent({
      agentSessionId: "s1",
      event: "sessionstart",
      cwd: "/tmp/p",
      parentSessionId: null,
      projectId: null,
      projectName: null,
      worktreeLabel: null,
      branch: null,
      profile: null,
      lastUserMsg: null,
      ptySessionId: null,
      at: 1000,
    });
    expect(live.getEntry("s1")?.agent).toBe("claude");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/live-codex.test.ts`
Expected: FAIL — `agent` is `undefined` (property does not exist on `LiveEntry`).

- [ ] **Step 3: Add the type and field**

In `server/src/sessions/live.ts`, at the top (after the `LiveState` type on line 1):

```ts
export type AgentKind = "claude" | "codex";
```

In the `LiveEntry` type, add `agent` as the first field:

```ts
export type LiveEntry = {
  agent: AgentKind;
  agentSessionId: string;
  parentSessionId: string | null;
  // …unchanged…
};
```

In `applyHookEvent`, add `agent: "claude",` as the first field of the constructed `entry` object (it is inserted, not merged from `prev`, because a session's agent never changes):

```ts
    const entry: LiveEntry = {
      agent: "claude",
      agentSessionId: u.agentSessionId,
      // …unchanged…
    };
```

In `noteHeadlessRunStarted`, add `agent: "claude",` as the first field of the object passed to `this.entries.set(...)`:

```ts
    this.entries.set(a.agentSessionId, {
      agent: "claude",
      agentSessionId: a.agentSessionId,
      // …unchanged…
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/live-codex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/live.ts server/tests/live-codex.test.ts
git commit -m "feat(sessions): add agent field to live-session model"
```

---

## Task 2: `LiveAgentSessions.applyCodexScan()`

**Files:**
- Modify: `server/src/sessions/live.ts`
- Test: `server/tests/live-codex.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/tests/live-codex.test.ts` inside the `describe` block:

```ts
  test("applyCodexScan upserts a codex entry with no profile", () => {
    const live = new LiveAgentSessions();
    live.applyCodexScan({
      agentSessionId: "cx1",
      cwd: "/tmp/studio",
      projectId: "proj",
      projectName: "studio",
      worktreeLabel: "main",
      ptySessionId: "pty-9",
      state: "working",
      endedAt: null,
      startedAt: 1000,
      lastEventAt: 2000,
      lastUserMsg: "hi",
    });
    const e = live.getEntry("cx1");
    expect(e?.agent).toBe("codex");
    expect(e?.profile).toBeNull();
    expect(e?.parentSessionId).toBeNull();
    expect(e?.ptySessionId).toBe("pty-9");
    expect(live.list()).toHaveLength(1);
  });

  test("applyCodexScan does not disturb an existing claude entry", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent({
      agentSessionId: "s1", event: "sessionstart", cwd: "/tmp/p",
      parentSessionId: null, projectId: null, projectName: null,
      worktreeLabel: null, branch: null, profile: "personal",
      lastUserMsg: null, ptySessionId: null, at: 1000,
    });
    live.applyCodexScan({
      agentSessionId: "cx1", cwd: "/tmp/studio", projectId: null, projectName: null,
      worktreeLabel: null, ptySessionId: null, state: "waiting",
      endedAt: null, startedAt: 1000, lastEventAt: 2000, lastUserMsg: null,
    });
    expect(live.getEntry("s1")?.agent).toBe("claude");
    expect(live.getEntry("s1")?.profile).toBe("personal");
    expect(live.list()).toHaveLength(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/live-codex.test.ts`
Expected: FAIL — `applyCodexScan` is not a function.

- [ ] **Step 3: Implement `applyCodexScan`**

In `server/src/sessions/live.ts`, add this exported type near `LiveUpdate` (after line 42):

```ts
/** A Codex rollout snapshot from the disk scanner. Codex has no hooks, so the
 *  scanner computes state/endedAt itself and overwrites the entry each tick. */
export type CodexScanEntry = {
  agentSessionId: string;
  cwd: string;
  projectId: string | null;
  projectName: string | null;
  worktreeLabel: string | null;
  ptySessionId: string | null;
  state: LiveState;
  endedAt: number | null;
  startedAt: number;
  lastEventAt: number;
  lastUserMsg: string | null;
};
```

Add this method to the `LiveAgentSessions` class (e.g. right after `applyHookEvent`):

```ts
  /** Upsert a Codex session discovered by the disk scanner. Keyed by the Codex
   *  session_id (a UUID distinct from any Claude id), so it never collides with
   *  hook-driven entries. Codex is global: no profile, no parent. */
  applyCodexScan(e: CodexScanEntry): void {
    const prev = this.entries.get(e.agentSessionId);
    this.entries.set(e.agentSessionId, {
      agent: "codex",
      agentSessionId: e.agentSessionId,
      parentSessionId: null,
      projectId: e.projectId,
      projectName: e.projectName,
      cwd: e.cwd || prev?.cwd || "",
      worktreeLabel: e.worktreeLabel,
      branch: null,
      profile: null,
      ptySessionId: e.ptySessionId,
      state: e.state,
      endedAt: e.endedAt,
      startedAt: prev?.startedAt ?? e.startedAt,
      lastEventAt: e.lastEventAt,
      lastUserMsg: e.lastUserMsg,
      launchedVia: null,
    });
    this.notify({ event: "codexscan", agentSessionId: e.agentSessionId });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/live-codex.test.ts`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/live.ts server/tests/live-codex.test.ts
git commit -m "feat(sessions): applyCodexScan to feed codex sessions into live store"
```

---

## Task 3: `parseCodexRollout()` — pure rollout parser

**Files:**
- Create: `server/src/sessions/codex-scanner.ts`
- Test: `server/tests/codex-scanner.test.ts`

Codex rollout lines are JSON objects. The first-line `session_meta` carries
`payload.session_id`, `payload.cwd`, `payload.timestamp`. Message lines look like
`{"timestamp":"…","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"…"}]}}`.
The very first user message is an `<environment_context>` wrapper and must be
skipped when choosing a display message.

- [ ] **Step 1: Write the failing test**

Create `server/tests/codex-scanner.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseCodexRollout } from "../src/sessions/codex-scanner";

const rollout = [
  JSON.stringify({ timestamp: "2026-08-12T14:23:46.513Z", type: "session_meta",
    payload: { session_id: "cx-1", cwd: "/Users/me/studio", timestamp: "2026-08-12T14:23:46.513Z" } }),
  JSON.stringify({ timestamp: "2026-08-12T14:24:24.371Z", type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/Users/me/studio</cwd>\n</environment_context>" }] } }),
  JSON.stringify({ timestamp: "2026-08-12T14:24:30.000Z", type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "add better codex support" }] } }),
  JSON.stringify({ timestamp: "2026-08-12T14:25:00.000Z", type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "text", text: "on it" }] } }),
].join("\n");

describe("parseCodexRollout", () => {
  test("extracts meta, last activity, and first real user message", () => {
    const r = parseCodexRollout(rollout);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionId).toBe("cx-1");
    expect(r.cwd).toBe("/Users/me/studio");
    expect(r.startedAt).toBe(Date.parse("2026-08-12T14:23:46.513Z"));
    expect(r.lastEventAt).toBe(Date.parse("2026-08-12T14:25:00.000Z"));
    expect(r.lastUserMsg).toBe("add better codex support"); // env-context skipped
  });

  test("returns ok:false when session_meta is missing", () => {
    expect(parseCodexRollout('{"type":"response_item","payload":{}}').ok).toBe(false);
  });

  test("tolerates blank and malformed lines", () => {
    const text = "\n{not json}\n" + rollout;
    expect(parseCodexRollout(text).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: FAIL — module `codex-scanner` / `parseCodexRollout` not found.

- [ ] **Step 3: Implement `parseCodexRollout`**

Create `server/src/sessions/codex-scanner.ts` with (only the parser for now):

```ts
export type ParsedCodexRollout =
  | {
      ok: true;
      sessionId: string;
      cwd: string;
      startedAt: number;
      lastEventAt: number;
      lastUserMsg: string | null;
    }
  | { ok: false };

/** Pull the display text out of a Codex message `content` (array of parts, or a
 *  bare string in older formats). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
      parts.push((p as { text: string }).text);
    }
  }
  return parts.join("");
}

/** Parse a Codex rollout JSONL. Skips blank/malformed lines. Returns ok:false
 *  when there is no `session_meta` (the file is not a usable rollout). */
export function parseCodexRollout(text: string): ParsedCodexRollout {
  let sessionId: string | null = null;
  let cwd = "";
  let startedAt = 0;
  let lastEventAt = 0;
  let lastUserMsg: string | null = null;

  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof obj?.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
    if (!Number.isNaN(ts) && ts > lastEventAt) lastEventAt = ts;

    const payload = obj?.payload;
    if (obj?.type === "session_meta" && payload?.session_id) {
      sessionId = String(payload.session_id);
      cwd = typeof payload.cwd === "string" ? payload.cwd : "";
      const metaTs = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : ts;
      startedAt = Number.isNaN(metaTs) ? 0 : metaTs;
      continue;
    }
    if (payload?.type === "message" && payload?.role === "user" && lastUserMsg === null) {
      const t = messageText(payload.content).trim();
      if (t.length > 0 && !t.startsWith("<environment_context>")) lastUserMsg = t;
    }
  }

  if (!sessionId) return { ok: false };
  if (lastEventAt === 0) lastEventAt = startedAt;
  return { ok: true, sessionId, cwd, startedAt, lastEventAt, lastUserMsg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/codex-scanner.ts server/tests/codex-scanner.test.ts
git commit -m "feat(codex): parse codex rollout jsonl into a session snapshot"
```

---

## Task 4: `buildCodexEntry()` — correlation + state heuristic

**Files:**
- Modify: `server/src/sessions/codex-scanner.ts`
- Test: `server/tests/codex-scanner.test.ts`

Turns a parsed rollout into a `CodexScanEntry`: classify the project from cwd,
correlate to a live Codex terminal by cwd (to enable focus), and derive state.

State rules (from the spec):

| Condition | state | endedAt | ptySessionId |
|---|---|---|---|
| matching live Codex PTY | `working` if `now - lastEventAt < 30_000`, else `waiting` | `null` | the PTY id |
| no PTY, `now - lastEventAt < 60_000` | `waiting` | `null` | `null` |
| no PTY, older | `stale` | `lastEventAt` | `null` |

- [ ] **Step 1: Write the failing test**

Append to `server/tests/codex-scanner.test.ts`:

```ts
import { buildCodexEntry } from "../src/sessions/codex-scanner";

const parsed = {
  ok: true as const,
  sessionId: "cx-1",
  cwd: "/Users/me/studio",
  startedAt: 1000,
  lastEventAt: 5000,
  lastUserMsg: "hello",
};
const projects = [{ id: "studio", path: "/Users/me/studio" }];
const projectName = (id: string) => (id === "studio" ? "Studio" : null);

describe("buildCodexEntry", () => {
  test("matched live terminal → focusable, working when fresh", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 10_000,
      projects,
      projectName,
      liveCodexTerminals: [{ ptySessionId: "pty-1", cwd: "/Users/me/studio", startedAt: 900 }],
    });
    expect(e.ptySessionId).toBe("pty-1");
    expect(e.endedAt).toBeNull();
    expect(e.state).toBe("working");
    expect(e.projectId).toBe("studio");
    expect(e.projectName).toBe("Studio");
    expect(e.worktreeLabel).toBe("main");
  });

  test("matched live terminal but idle → waiting", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 45_000,
      projects, projectName,
      liveCodexTerminals: [{ ptySessionId: "pty-1", cwd: "/Users/me/studio", startedAt: 900 }],
    });
    expect(e.state).toBe("waiting");
    expect(e.endedAt).toBeNull();
  });

  test("no terminal, recent activity → waiting, inert", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 30_000, projects, projectName, liveCodexTerminals: [],
    });
    expect(e.ptySessionId).toBeNull();
    expect(e.state).toBe("waiting");
    expect(e.endedAt).toBeNull();
  });

  test("no terminal, old activity → stale, closed", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 120_000, projects, projectName, liveCodexTerminals: [],
    });
    expect(e.ptySessionId).toBeNull();
    expect(e.state).toBe("stale");
    expect(e.endedAt).toBe(5000);
  });

  test("picks the most recent terminal when several share the cwd", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 10_000, projects, projectName,
      liveCodexTerminals: [
        { ptySessionId: "old", cwd: "/Users/me/studio", startedAt: 100 },
        { ptySessionId: "new", cwd: "/Users/me/studio", startedAt: 900 },
      ],
    });
    expect(e.ptySessionId).toBe("new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: FAIL — `buildCodexEntry` not exported.

- [ ] **Step 3: Implement `buildCodexEntry`**

Add to `server/src/sessions/codex-scanner.ts`:

```ts
import { classifyCwd } from "./scanner";
import type { CodexScanEntry, LiveState } from "./live";

export type CodexTerminal = { ptySessionId: string; cwd: string; startedAt: number };

export type BuildCodexCtx = {
  now: number;
  projects: Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
  liveCodexTerminals: CodexTerminal[];
};

const WORKING_WINDOW_MS = 30_000; // fresh write ⇒ actively working
const ACTIVE_WINDOW_MS = 60_000; // recent but no terminal ⇒ still live, inert

export function buildCodexEntry(
  parsed: Extract<ParsedCodexRollout, { ok: true }>,
  ctx: BuildCodexCtx,
): CodexScanEntry {
  const { projectId, worktreeLabel } = classifyCwd(parsed.cwd, ctx.projects);
  const match = ctx.liveCodexTerminals
    .filter((t) => t.cwd === parsed.cwd)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  const idle = ctx.now - parsed.lastEventAt;
  let state: LiveState;
  let endedAt: number | null;
  if (match) {
    state = idle < WORKING_WINDOW_MS ? "working" : "waiting";
    endedAt = null;
  } else if (idle < ACTIVE_WINDOW_MS) {
    state = "waiting";
    endedAt = null;
  } else {
    state = "stale";
    endedAt = parsed.lastEventAt;
  }

  return {
    agentSessionId: parsed.sessionId,
    cwd: parsed.cwd,
    projectId,
    projectName: projectId ? ctx.projectName(projectId) : null,
    worktreeLabel,
    ptySessionId: match?.ptySessionId ?? null,
    state,
    endedAt,
    startedAt: parsed.startedAt,
    lastEventAt: parsed.lastEventAt,
    lastUserMsg: parsed.lastUserMsg,
  };
}
```

Note: `LiveState` is already exported from `server/src/sessions/live.ts` (line 1); `CodexScanEntry` was exported in Task 2. `classifyCwd` is exported from `server/src/sessions/scanner.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/codex-scanner.ts server/tests/codex-scanner.test.ts
git commit -m "feat(codex): build live-session entry with cwd correlation and state"
```

---

## Task 5: `scanCodexSessions()` — filesystem walk

**Files:**
- Modify: `server/src/sessions/codex-scanner.ts`
- Test: `server/tests/codex-scanner.test.ts`

Walks `~/.codex/sessions/**/*.jsonl`, skips files whose mtime is older than the
live window (a live Codex session writes continuously, so its rollout mtime stays
fresh), parses, builds an entry, and calls `apply`. Thin glue — tested against a
real temp dir.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/codex-scanner.test.ts`:

```ts
import { scanCodexSessions } from "../src/sessions/codex-scanner";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scanCodexSessions", () => {
  test("parses recent rollouts and skips stale files", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
    const day = join(root, "2026", "08", "12");
    mkdirSync(day, { recursive: true });

    const fresh = join(day, "rollout-fresh.jsonl");
    writeFileSync(fresh, JSON.stringify({
      timestamp: "2026-08-12T14:23:46.513Z", type: "session_meta",
      payload: { session_id: "fresh-1", cwd: "/w/proj", timestamp: "2026-08-12T14:23:46.513Z" },
    }));

    const stale = join(day, "rollout-stale.jsonl");
    writeFileSync(stale, JSON.stringify({
      timestamp: "2020-01-01T00:00:00.000Z", type: "session_meta",
      payload: { session_id: "stale-1", cwd: "/w/proj", timestamp: "2020-01-01T00:00:00.000Z" },
    }));
    const old = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(stale, old, old);

    const applied: string[] = [];
    scanCodexSessions({
      sessionsRoot: root,
      now: Date.now(),
      liveWindowMs: 30 * 60_000,
      projects: [{ id: "proj", path: "/w/proj" }],
      projectName: () => "Proj",
      liveCodexTerminals: [],
      apply: (e) => applied.push(e.agentSessionId),
    });

    expect(applied).toContain("fresh-1");
    expect(applied).not.toContain("stale-1");
  });

  test("missing sessions root is a no-op", () => {
    let calls = 0;
    scanCodexSessions({
      sessionsRoot: "/no/such/dir/at/all",
      now: Date.now(), liveWindowMs: 1000,
      projects: [], projectName: () => null, liveCodexTerminals: [],
      apply: () => calls++,
    });
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: FAIL — `scanCodexSessions` not exported.

- [ ] **Step 3: Implement `scanCodexSessions`**

Add to `server/src/sessions/codex-scanner.ts` (imports at top of file):

```ts
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
```

```ts
export type ScanCodexDeps = {
  sessionsRoot: string;
  now: number;
  liveWindowMs: number;
  projects: Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
  liveCodexTerminals: CodexTerminal[];
  apply: (e: CodexScanEntry) => void;
};

/** Recursively collect *.jsonl paths under `dir`. */
function collectJsonl(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) collectJsonl(full, out);
    else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
  }
}

export function scanCodexSessions(deps: ScanCodexDeps): void {
  if (!existsSync(deps.sessionsRoot)) return;
  const files: string[] = [];
  collectJsonl(deps.sessionsRoot, files);
  const cutoff = deps.now - deps.liveWindowMs;
  for (const full of files) {
    let mtime: number;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (mtime < cutoff) continue; // a live rollout stays fresh; old ones age out
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const parsed = parseCodexRollout(text);
    if (!parsed.ok) continue;
    deps.apply(
      buildCodexEntry(parsed, {
        now: deps.now,
        projects: deps.projects,
        projectName: deps.projectName,
        liveCodexTerminals: deps.liveCodexTerminals,
      }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/codex-scanner.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/codex-scanner.ts server/tests/codex-scanner.test.ts
git commit -m "feat(codex): scan ~/.codex/sessions for recent rollouts"
```

---

## Task 6: `SessionRegistry.list()`

**Files:**
- Modify: `server/src/sessions/registry.ts`
- Test: `server/tests/registry-list.test.ts`

The scan loop needs to enumerate every live PTY across all projects to find
running Codex terminals. The registry currently exposes only per-project lookups.

- [ ] **Step 1: Write the failing test**

Create `server/tests/registry-list.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/sessions/registry";

function fakePty() {
  return {
    pid: Math.floor(Math.random() * 100000),
    onData() {}, onExit() {}, write() {}, resize() {}, kill() {},
  };
}

describe("SessionRegistry.list", () => {
  test("returns every live session across projects", () => {
    const reg = new SessionRegistry({
      pty: () => fakePty() as any,
      maxTotal: 10,
      maxScrollbackBytes: 1000,
      defaultShell: "/bin/zsh",
    });
    reg.create({ projectId: "a", cwd: "/a", cols: 80, rows: 24, launcher: { id: "codex", agent: "codex" } });
    reg.create({ projectId: "b", cwd: "/b", cols: 80, rows: 24 });
    expect(reg.list()).toHaveLength(2);
    expect(reg.list().map((s) => s.cwd).sort()).toEqual(["/a", "/b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/registry-list.test.ts`
Expected: FAIL — `reg.list` is not a function.

- [ ] **Step 3: Implement `list()`**

In `server/src/sessions/registry.ts`, add after `get()` (line 84):

```ts
  /** Every live session, across all projects. */
  list(): Session[] {
    return [...this.sessions.values()];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/registry-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/registry.ts server/tests/registry-list.test.ts
git commit -m "feat(sessions): SessionRegistry.list() to enumerate all live ptys"
```

---

## Task 7: Wire the Codex scan loop into the server

**Files:**
- Modify: `server/src/index.ts`

No new unit test — this is composition of already-tested units. Verified by
typecheck and a manual smoke run.

- [ ] **Step 1: Add the import**

In `server/src/index.ts`, near the other `./sessions/*` imports (around line 40),
add:

```ts
import { scanCodexSessions } from "./sessions/codex-scanner";
```

- [ ] **Step 2: Add the scan loop**

In `server/src/index.ts`, immediately after `projectsForRunner` is defined
(currently line 141 — the loop must appear after `projectNameById` on line 140),
insert:

```ts
// Codex has no hooks: poll its rollout logs and feed recent/live sessions into
// the same live-session store the session bar reads. Mirrors the AgentDetector
// cadence. Additive — never touches the Claude hook path or the vault.
const codexSessionsRoot = join(homedir(), ".codex", "sessions");
function liveCodexTerminals() {
  const out: { ptySessionId: string; cwd: string; startedAt: number }[] = [];
  for (const s of sessions.list()) {
    const agent = s.launcher?.agent ?? detector.get(s.pty.pid) ?? null;
    if (agent === "codex") out.push({ ptySessionId: s.id, cwd: s.cwd, startedAt: s.createdAt });
  }
  return out;
}
setInterval(() => {
  try {
    scanCodexSessions({
      sessionsRoot: codexSessionsRoot,
      now: Date.now(),
      liveWindowMs: 30 * 60_000,
      projects: listVisibleProjects(db).map((p) => ({ id: p.id, path: p.path })),
      projectName: projectNameById,
      liveCodexTerminals: liveCodexTerminals(),
      apply: (e) => liveSessions.applyCodexScan(e),
    });
  } catch (err) {
    log("warn", "codex-scan: failed", { error: (err as Error).message });
  }
}, 3_000);
```

Note: `join` and `homedir` are already imported in this file (used by
`configDirs()` at line 184 and elsewhere). `detector`, `sessions`,
`liveSessions`, `listVisibleProjects`, `db`, `projectNameById`, and `log` are all
already in scope.

- [ ] **Step 3: Typecheck the server**

Run: `cd server && bunx tsc --noEmit -p .`
Expected: no errors. (If `-p .` reports no tsconfig, run `cd server && bunx tsc --noEmit src/index.ts` and confirm no new errors from the changed files.)

- [ ] **Step 4: Smoke test the whole server suite**

Run: `cd server && bun test`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(codex): poll ~/.codex/sessions and surface codex sessions live"
```

---

## Task 8: Shared agent-emoji helper (web)

**Files:**
- Create: `web/src/lib/agents.ts`
- Test: `web/tests/agents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/agents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentIcon } from "../src/lib/agents";

describe("agentIcon", () => {
  it("maps known agents to distinct emoji", () => {
    expect(agentIcon("claude")).toBe("✳️");
    expect(agentIcon("codex")).toBe("⚡");
    expect(agentIcon("claude")).not.toBe(agentIcon("codex"));
  });
  it("falls back to a generic robot for unknown/absent agents", () => {
    expect(agentIcon("aider")).toBe("🤖");
    expect(agentIcon(null)).toBe("🤖");
    expect(agentIcon(undefined)).toBe("🤖");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test agents`
Expected: FAIL — cannot resolve `../src/lib/agents`.

- [ ] **Step 3: Implement the helper**

Create `web/src/lib/agents.ts`:

```ts
// Distinct glyph per coding agent, shared by the tab strip and the session bar
// so the two surfaces stay consistent. Swap the emoji here to restyle globally.
export const AGENT_ICON: Record<string, string> = {
  claude: "✳️",
  codex: "⚡",
};

/** Emoji for an agent id; a generic robot for anything unmapped or absent. */
export function agentIcon(agent?: string | null): string {
  return (agent && AGENT_ICON[agent]) || "🤖";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test agents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/agents.ts web/tests/agents.test.ts
git commit -m "feat(web): shared per-agent emoji helper"
```

---

## Task 9: Session-bar chip shows the agent (web)

**Files:**
- Modify: `web/src/api.ts` (add `agent` to `LiveSessionRow`)
- Modify: `web/src/components/SessionBar.tsx`

- [ ] **Step 1: Add `agent` to the `LiveSessionRow` type**

In `web/src/api.ts`, in the `LiveSessionRow` type (starts line 540), add `agent`
as the first field:

```ts
export type LiveSessionRow = {
  agent: string;
  agentSessionId: string;
  // …unchanged…
};
```

- [ ] **Step 2: Render the agent emoji on each chip**

In `web/src/components/SessionBar.tsx`:

Add the import near the top (after line 3):

```ts
import { agentIcon } from "../lib/agents";
```

Inside the chip `<button>`, add an agent glyph immediately after the status dot
(after line 60, before the profile `<Show>`):

```tsx
              <span class="session-chip-dot session-chip-dot-… (unchanged line 60) />
              <span class="session-chip-agent" aria-hidden="true">{agentIcon(s.agent)}</span>
              <Show when={s.profile && s.profile !== "default"}>
```

The existing profile `<Show>` already renders nothing for Codex (its `profile` is
`null`), so no badge shows for Codex — exactly as specified. Also add the agent
name into the chip tooltip: in `chipTitle`, change the first `parts` line
(line 16) to include the agent:

```ts
  const parts = [`${s.agent}: ${s.lastUserMsg ?? s.agentSessionId}`];
```

- [ ] **Step 3: Add minimal styling**

In `web/src/styles.css`, near the session-chip rules (~line 997), add:

```css
.session-chip-agent { font-size: 0.85em; line-height: 1; }
```

- [ ] **Step 4: Verify build/typecheck**

Run: `cd web && bun run build`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/components/SessionBar.tsx web/src/styles.css
git commit -m "feat(web): show agent emoji on session-bar chips"
```

---

## Task 10: Terminal tab shows a per-agent glyph (web)

**Files:**
- Modify: `web/src/components/TabStrip.tsx`

The tab already receives `t.agent` (from `/api/sessions`, which returns
`launcher.agent ?? detector` and already recognizes `codex`). This task is purely
presentational: swap the constant `🤖` for the per-agent glyph.

- [ ] **Step 1: Add the import**

In `web/src/components/TabStrip.tsx`, after line 3:

```ts
import { agentIcon } from "../lib/agents";
```

- [ ] **Step 2: Use the per-agent glyph**

Replace line 46:

```tsx
              {t.kind === "terminal" && t.agent ? "🤖 " : ""}
```

with:

```tsx
              {t.kind === "terminal" && t.agent ? agentIcon(t.agent) + " " : ""}
```

- [ ] **Step 3: Verify build/typecheck**

Run: `cd web && bun run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TabStrip.tsx
git commit -m "feat(web): per-agent glyph on terminal tabs (claude vs codex)"
```

---

## Task 11: Full verification

- [ ] **Step 1: Server tests**

Run: `cd server && bun test`
Expected: all PASS.

- [ ] **Step 2: Web tests**

Run: `cd web && bun run test`
Expected: all PASS.

- [ ] **Step 3: Web build**

Run: `cd web && bun run build`
Expected: succeeds, no type errors.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Start the dev server (`bun run dev:server` + `bun run dev:web`), open a `codex`
launcher in a project that has a live rollout under `~/.codex/sessions`, and
confirm: (a) the terminal tab shows the ⚡ glyph, (b) a ⚡ chip appears in the
session bar, (c) clicking the chip focuses the Codex terminal, (d) a Claude
terminal in the same window shows ✳️ and its chip still shows its profile badge.

- [ ] **Step 5: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "chore(codex): verification pass for codex session support" || true
```

---

## Self-Review Notes

- **Spec coverage:** `agent` field (Task 1) → both features; scanner ingest (Tasks 3–5,7); cwd correlation + state heuristic (Task 4); session-bar chip + no Codex profile badge (Task 9); distinct emoji on tabs (Task 10) and chips (Task 9); closed/external graceful handling (Task 4 state rules + existing inert-chip logic in `SessionBar`). No vault/DB changes — matches "focus terminal only" scope.
- **Type consistency:** `CodexScanEntry` defined in Task 2 is produced by `buildCodexEntry` (Task 4) and consumed by `applyCodexScan` (Task 2) and `scanCodexSessions` (Task 5) — same field set throughout. `LiveState` and `AgentKind` come from `live.ts`. `agentIcon` signature identical across Tasks 8–10.
- **Known limitation (documented in spec):** cwd-based correlation can mislink two Codex terminals sharing a cwd; Task 4 picks the most recent and accepts it.
