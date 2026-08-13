# Codex Session Support — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)

## Problem

Forest is Claude-centric. Two concrete gaps appear now that Codex (OpenAI's CLI)
is in use:

1. **You can't tell which terminals run Claude vs Codex at a glance.** Every
   agent terminal tab shows a generic `🤖` (`web/src/components/TabStrip.tsx:46`);
   the actual agent name is buried in the hover tooltip.
2. **Codex sessions never appear in the session bar.** The bar
   (`web/src/components/SessionBar.tsx`) is fed exclusively by Claude Code's
   hook-ingest plus the Claude transcript scanner. Codex writes nothing to
   Forest, so it contributes zero chips.

Codex is currently a **global** tool for the user — there is no personal vs
professional profile split (unlike Claude's `.claude-<name>` config dirs). That
is fine "for now" and this design does not try to add Codex profiles.

## Root insight

Both gaps reduce to one missing concept: **Forest's live-session and terminal
models have no first-class "which agent" field.** The `agent` string already
flows out of `/api/sessions` (`launcher.agent ?? detector.get(pid)`), and the
process detector already recognizes `codex` (`server/src/index.ts:95`). What's
missing is (a) carrying `agent` onto the *live-session* model that the bar reads,
and (b) a source that puts Codex sessions into that live-session store.

## Scope (agreed)

- Codex chips appear in the session bar.
- Clicking a Codex chip **focuses the live Forest terminal** when one is open.
- **Closed / external Codex sessions are handled gracefully** — inert chip, no
  broken transcript reader.
- **No Codex transcript reader** and therefore **no Codex vault ingest** — the
  scanner feeds only the in-memory `LiveAgentSessions` store. No SQLite/vault
  schema changes, no Codex message parser beyond what a chip needs (first user
  message for the tooltip).
- Claude vs Codex distinguished by **distinct emoji**; Codex chips show **no
  profile badge** (the agent icon alone identifies it).

Out of scope: Codex profiles, Codex transcript viewing/resume, Codex hooks.

## What Codex gives us on disk

Standard rollout JSONL at
`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl`. First line is a
`session_meta` record:

```json
{"type":"session_meta","payload":{"session_id":"019ff65b-…","cwd":"/Users/…/studio-docker-compose","cli_version":"0.147.0","timestamp":"2026-08-12T14:23:46.513Z", …}}
```

Subsequent lines include `response_item` records with `payload.type == "message"`
and `role == "user" | "assistant"` (the first real user message is wrapped in an
`<environment_context>` block that must be skipped when picking a display
message). File mtime and the last line's timestamp give "last activity."

## Design

### 1. `agent` on the live-session model

Add `agent: AgentKind` (`"claude" | "codex"`) to `LiveEntry` / `LiveSessionRow`
(`server/src/sessions/live.ts`) and to the `LiveSessionRow` type in
`web/src/api.ts`. All existing Claude write paths (`applyHookEvent`,
`noteHeadlessRunStarted`) set `agent: "claude"`. This is the one shared change
that both features build on.

### 2. `CodexSessionScanner` (server)

New module `server/src/sessions/codex-scanner.ts` plus a poll loop wired in
`server/src/index.ts` next to the existing `AgentDetector` loop (~line 97).

Responsibilities each tick (default every 3s, matching the detector cadence):

1. **Enumerate recent rollouts.** Walk `~/.codex/sessions/**`, considering only
   files whose mtime is within the live window (the `LiveAgentSessions`
   ended-retention, ~30 min) **or** that correspond to a currently-running Codex
   PTY. This keeps the shared 10-chip bar from flooding with old sessions and
   mirrors how Claude closed sessions age out.
2. **Parse cheaply.** Read `session_meta` (session_id, cwd, started-at) and
   derive `lastEventAt` from the last line's timestamp (fallback: file mtime) and
   `lastUserMsg` from the first non-environment user message. An mtime cache
   (like the vault's `mtimeFor`) skips unchanged files.
3. **Classify project.** Reuse `classifyCwd(cwd, projects)` from
   `server/src/sessions/scanner.ts` to get `projectId` / `worktreeLabel`.
4. **Correlate to a live terminal.** From the `SessionRegistry`, find a live PTY
   with `launcher.agent === "codex"` (or detector-tagged codex) whose `cwd`
   matches the rollout `cwd`; attach its `ptySessionId` so the chip can focus the
   terminal. If several match, pick the most recent. If none match, the chip is
   left un-focusable (see state rules).
5. **Feed the live store** via a new method
   `LiveAgentSessions.applyCodexScan(entry)` that upserts a `LiveEntry` keyed by
   the Codex `session_id` with `agent: "codex"`, `profile: null`,
   `parentSessionId: null`.

**State heuristic** (Codex emits no stop/notification signals):

| Condition | `state` | `endedAt` | `ptySessionId` |
|---|---|---|---|
| Matching live Codex PTY exists | `working` if modified < ~30s ago, else `waiting` | `null` | the PTY's id (focusable) |
| No live PTY, modified very recently (< ~60s) | `waiting` | `null` | `null` (active but inert) |
| No live PTY, older | `stale` | last activity ts (closed) | `null` |

`prune()` already drops closed entries after the retention window, so no extra
cleanup is needed.

**Idempotency & isolation:** the scanner only ever calls `applyCodexScan`; it
never touches the Claude hook path, the vault, or existing entries keyed by
Claude session ids (Codex ids are distinct UUIDs). If `~/.codex/sessions` does
not exist, the loop is a no-op.

### 3. Session-bar chip (web)

In `SessionBar.tsx`, render a per-agent emoji at the start of each chip driven by
`s.agent`. Replace the profile-badge `<Show>` so Codex (`profile` null) shows the
agent icon and no badge, while Claude keeps its existing profile badge behavior.
Codex chip click behavior falls out of existing logic: `isLiveForestSession`
(has `ptySessionId`, not ended) → focus terminal; otherwise inert/closed exactly
like a Claude chip with no project. No new click paths.

### 4. Terminal tab glyph (web)

In `TabStrip.tsx:46`, replace the constant `🤖` with a lookup on `t.agent`
(`claude` → one emoji, `codex` → another, unknown agent → the current `🤖`
fallback). The hover tooltip already shows the agent name and stays.

### Emoji mapping

A single shared map (e.g. `web/src/lib/agents.ts`) so the tab strip and the
session bar stay consistent:

```ts
export const AGENT_ICON: Record<string, string> = { claude: "✳️", codex: "⚡" };
export const agentIcon = (a?: string | null) => (a && AGENT_ICON[a]) || "🤖";
```

Exact glyphs are trivially swappable — the point is that Claude and Codex differ
and both are consistent between the two surfaces.

## Data flow

```
~/.codex/sessions/**/*.jsonl
        │  (poll every 3s)
        ▼
CodexSessionScanner ──classifyCwd──► projectId/worktree
        │  correlate cwd ──► SessionRegistry (live codex PTYs) ──► ptySessionId
        ▼
LiveAgentSessions.applyCodexScan({ agent:"codex", … })
        │
        ▼  (shared store, GET /api/agent-sessions/live, cap 10)
SessionBar ──► chip with ⚡ icon, focus-terminal on click
```

## Testing

- **`codex-scanner` unit tests** (Vitest/bun): parse a fixture rollout →
  session_id, cwd, lastEventAt, lastUserMsg (environment_context skipped);
  mtime-cache skip; missing-dir no-op; project classification via `classifyCwd`.
- **`LiveAgentSessions.applyCodexScan`**: upsert sets `agent:"codex"`,
  `profile:null`; closed vs live state transitions; does not disturb Claude
  entries; participates in `list()` ordering/cap.
- **Correlation**: given a fake registry with a matching codex PTY, chip gets
  `ptySessionId`; with none, chip is inert.
- **Web**: `SessionBar` renders the codex emoji and no profile badge for a
  `codex` row; a live codex row navigates to the terminal on click. `TabStrip`
  renders the per-agent glyph.

## Risks / limitations

- **cwd-based correlation** can mis-link when two Codex terminals share a cwd;
  v1 picks the most recent and accepts the edge case (focus lands on one of
  them). Documented, not solved here.
- **State is heuristic** (mtime-derived) rather than event-driven; a Codex
  session sitting idle mid-task will read `waiting`/`stale`. Acceptable given no
  Codex hooks in scope.
- **10-chip shared cap** is unchanged; a burst of Codex + Claude activity shows
  the 10 most recent across both. Intentional.
