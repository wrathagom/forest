# Session summaries and key moments

**Date:** 2026-07-22
**Status:** Approved (design)

## Problem

Clicking a historical session in the info pane's **sessions** tab opens a
`SessionTranscript` tab: a token/tool-call header and then the raw message list,
oldest first. To find out what a session was actually about you scroll it.

A session that ran for two hundred messages is not readable this way. The user
wants, at the top of that view, a **short prose summary of the conversation**
plus **links to key moments** that jump into the transcript.

Neither exists in the data Forest already has. `first_user_msg` is the opening
prompt, not an outcome. Tool-call counts and token totals describe volume, not
substance. Producing a summary means asking a model.

## Scope

- A stored, cached summary and 3–6 key moments per agent session.
- Generated on first view of a session that has none, via a `claude -p`
  subprocess.
- Moments anchor to real transcript messages; clicking one scrolls the
  transcript to that message and flashes it.
- Staleness detection when a summarized session is later resumed.
- Capture of Claude Code's own `ai-title` records, which Forest currently
  discards.

Explicitly **not** in scope: summarizing live sessions automatically, a
background backfill sweep over existing history, cross-session or per-project
rollups, chunked map-reduce for very long sessions, and summaries for non-Claude
agents.

## Verified premises

The design rests on facts that were measured, not assumed. Claude Code 2.1.218,
2026-07-22.

**`claude -p` works.** It was widely believed headless had been removed. A run
against a real 202-message transcript digest (17k chars) with the exact flags
this design uses returned `exit 0`, `subtype: "success"`, `num_turns: 1` in 18
seconds. The resulting summary was accurate and **6 of 6 uuid anchors were
valid** — present in both the digest and the source transcript.

The confusion has a cause worth recording: on this machine `claude` on `PATH` is
a **shell function** installed by multi-agent-profiles that prompts
interactively for a profile and aborts under a non-interactive shell. Forest
must invoke the **binary** (`~/.local/bin/claude`), never the shell function.

**Output arrives fence-wrapped.** Haiku returned ` ```json … ``` ` despite an
explicit instruction to emit only JSON. Parsing must strip fences first.

**The subprocess pollutes Forest.** The verification run wrote a transcript into
the borrowed config dir and Forest ingested it —
`GET /api/agent-sessions/89393c1d-…` returned a real vault row. The guards in
this design are load-bearing, not precautionary.

**A dedicated config dir cannot be used.** Credentials live in the macOS Keychain
under names hashed per config dir (`Claude Code-credentials-25fa0d15`,
`-2a1b3b94`), so any fresh `CLAUDE_CONFIG_DIR` reports `Not logged in`. Copying
`.claude.json` does not help. The summarizer **must** borrow an existing
logged-in config dir, and therefore inherits that dir's plugins, skills, and
`SessionStart` hooks.

**Cost is dominated by harness overhead.** The 5k-token digest billed 34k tokens:

```
input: 10 · cache_creation: 16,456 · cache_read: 17,464 · output: 1,603 → $0.0427
```

About 87% of the price of a summary is Claude Code's system prompt, tool schemas,
plugin/skill listing, and injected `SessionStart` hook context — not the
transcript. Since the config dir cannot be slimmed, this is the floor:
**~$0.04 and ~18s per session.**

## Approach

Three mechanisms were considered.

**Deterministic heuristics only** — harvest `ai-title`, files touched, commits,
tool errors — was rejected as the primary mechanism. It yields a statistics card,
not a narrative, and 190 of 334 transcripts carry no `ai-title` at all. It
survives as a secondary source: `ai-title` capture is folded in below.

**A direct Anthropic Messages API call** is roughly 8× cheaper and 3× faster
(~$0.005, ~5s), writes no transcript, and would delete the pollution guards
entirely — most of this design's complexity is tax paid for subprocess auth. It
was rejected because it requires an `ANTHROPIC_API_KEY` config surface and bills
separately from the Max subscription already being paid for.

**A `claude -p` subprocess** was chosen. It reuses the subscription's existing
auth with no new secrets, and Forest already shells out to `claude -p` for mobile
launches (`sessions/runner.ts:76`), including an injectable `SpawnFn` seam built
for exactly this kind of testing. Its cost and pollution are known and bounded —
bounded specifically because generation is on-demand, so only sessions actually
opened are ever paid for.

## Architecture

### Summarizer

A new `SessionSummarizer` in `server/src/sessions/`, taking the same injectable
`SpawnFn` as `AgentRunner` so no test spawns a real binary.

```
claude -p <digest + instructions>
       --model claude-haiku-4-5-20251001
       --output-format json
       --allowed-tools ''
  cwd: <dataDir>/summarizer
  env: CLAUDE_CONFIG_DIR=<the session's own profile dir>, FOREST_INTERNAL=1
```

The config dir is resolved by matching `agent_sessions.profile` against
`claudeConfigDirs()`; a null or unrecognised profile falls back to the first
discovered dir. Borrowing the session's *own* profile matters because
credentials are per-dir — a session recorded under `personal` can only be
summarized with `personal`'s credentials.

Haiku 4.5 is the model: summarizing a prepared digest into a paragraph plus
labelled anchors is well within its range, and it is the cheapest option on a
path where the user is waiting.

The `claude` binary path resolves to `~/.local/bin/claude` or the configured
override — never a shell alias or function, per the premise above.

### Pollution control

Three independent guards, because each covers a different leak:

1. **`FOREST_INTERNAL=1`** — the ingest shim (`sessions/hook-installer.ts:34`,
   which Forest owns and rewrites on every boot) gains an early `exit 0` when the
   variable is set. Stops the summarizer run from appearing as a live session
   chip in the session bar.
2. **A neutral cwd** of `<dataDir>/summarizer`, outside the scan root, so
   `classifyCwd` yields `project_id: null` and the run cannot surface in any
   per-project session list.
3. **A scanner exclusion** for the summarizer slug directory in
   `scanClaudeProjects`, so the run never enters the vault at all and cannot
   appear in the cross-project sessions overview.

### Digest rendering

Built server-side from `agent_messages`, ordered by timestamp:

- One line per message: `[uuid] role: text`.
- Tool calls reduce to their name plus a short input line.
- Tool **results** reduce to `ok`/`error` and a byte count — never their body,
  which is where the token weight and the noise both live.
- Only messages yielding displayable text are included, matching the frontend's
  filter, so the model can only cite messages that will have a DOM node.
- ~1200 chars per message, ~60k chars total. Over budget keeps the head and tail
  with an `… N messages omitted …` marker between them.

Head-and-tail truncation rather than chunked map-reduce: map-reduce multiplies
latency and cost on a path the user is waiting on, and a two-stage pass makes
uuid anchoring materially harder to keep honest.

### Output contract and validation

The model is asked for:

```json
{"summary": "…", "moments": [{"uuid": "…", "label": "…"}]}
```

Parsing strips code fences first, then parses. Every returned uuid is checked
against the set of uuids actually present in the digest and **silently dropped if
absent** — this is the guard that keeps anchors from being hallucinated. If every
moment is invalid the summary is still stored, with zero moments. A missing or
unparseable summary is a failure.

### Job control

An in-process registry keyed by session id: dedupes concurrent requests for the
same session, caps concurrency at 2, times out at 90s, and kills outstanding
children on shutdown as `AgentRunner.shutdown()` does.

Sessions currently live and `working` are not auto-summarized — a moving target
would be summarized wrong — and offer a manual button instead. Sessions with
fewer than 4 displayable messages are skipped outright rather than spending $0.04
to summarize a two-line exchange.

### Storage

A new table in `store/db.ts` (`CREATE TABLE IF NOT EXISTS`, consistent with the
existing schema application):

```sql
CREATE TABLE IF NOT EXISTS agent_session_summaries (
  session_id            TEXT PRIMARY KEY
                          REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  summary               TEXT,
  moments               TEXT NOT NULL DEFAULT '[]',  -- JSON [{uuid,label}]
  model                 TEXT,
  status                TEXT NOT NULL,               -- 'ok' | 'error'
  error                 TEXT,
  generated_at          INTEGER NOT NULL,
  source_last_activity  INTEGER NOT NULL,
  source_message_count  INTEGER NOT NULL
);
```

The table stores only **terminal** outcomes, so `status` is `ok` or `error` and
nothing else. The API's `pending`, `absent`, and `skipped` are derived at request
time from the job registry and the session row — they are never rows. A row's
`summary` is null exactly when `status` is `error`.

Moments are sorted by their message's timestamp before being stored, so
transcript order is a property of the data rather than something the UI has to
re-derive.

`source_last_activity` and `source_message_count` are the staleness check: if a
summarized session is later resumed, the stored values fall behind the session
row and the UI marks the summary stale rather than quietly presenting an
outdated one as current.

Storing failures matters as much as storing successes — a persisted `error` stops
a broken session from re-burning $0.04 on every open.

### `ai-title` capture

Claude Code writes `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` records;
144 of 334 local transcripts have one. `parseClaudeJsonlLine` discards them —
they lack `cwd` and `timestamp`, so the guard at `parser.ts:113` rejects them
before the type is examined.

A branch ahead of that guard extracts the title into a new `title` column on
`agent_sessions` (added via the existing `addColumnIfMissing` helper). It is
free, already present, and gives the pending state something real to show instead
of a bare spinner.

While in that file, the `type === "summary"` branch at `parser.ts:202` is
removed: zero of the 334 local transcripts contain such a record, so it is dead
code for a format that no longer exists.

## API

Two routes in `routes/agent-sessions.ts`, registered **before** the existing
`/api/agent-sessions/([^/]+)$` catch-all, which would otherwise match `summary`.

- `GET /api/agent-sessions/:sid/summary` →
  `{status: "ready"|"pending"|"error"|"absent"|"skipped", summary?, moments?, model?, generatedAt?, stale?, error?}`
- `POST /api/agent-sessions/:sid/summary` with `{force?: boolean}` → enqueues,
  returns `{status: "pending"}`

The client GETs on open; if `absent` and the session is not live-`working`, it
POSTs and polls every 2s until a terminal status, capped at ~2 minutes.

## UI

**A schema fix is required for anchoring.** `getSessionDetail` does not select
`uuid` (`sessions/vault.ts:545`) even though `agent_messages` stores it. Add it
to the SELECT and to `AgentSessionDetail`, then `SessionTranscript`'s `<li>`
carries `data-msg-uuid`.

A new `SessionSummary.tsx` renders above `<ol class="session-transcript-body">`:
the prose paragraph, then moment chips in transcript order. States are pending
(shimmer, showing the `ai-title` if one exists), ready, stale (banner plus
regenerate), error (message plus retry), and skipped (nothing).

Clicking a moment runs `querySelector('[data-msg-uuid="…"]')`, then
`scrollIntoView({block: "center"})`, then applies a flash class removed after
~1.2s.

`visibleMessages` (`SessionTranscript.tsx:29`) drops messages parsing to zero
blocks, so an anchor could in principle point at a message with no DOM node. The
digest applies the same displayable-text filter, so the model can only cite
renderable messages; if `querySelector` still misses, the chip renders
unclickable rather than silently doing nothing.

## Error handling

| Failure | Behaviour |
|---|---|
| Spawn throws, non-zero exit, or 90s timeout | store `status:"error"` with the message; no automatic retry |
| Unparseable output after fence-stripping | store `status:"error"` |
| Some uuids invalid | drop those moments, keep the rest |
| All uuids invalid | store the summary with zero moments |
| Fewer than 4 displayable messages | `skipped`; never spawned |
| Session live and `working` | not auto-generated; manual button offered |

Retry after an error is user-initiated only.

## Testing

Server-side, all through the injected `SpawnFn` — no test spawns a real binary:

- digest rendering: ordering, per-message cap, head/tail budget truncation, tool
  results reduced to status
- output parsing: fenced, bare, and garbage input
- uuid validation: bogus dropped, all-bogus keeps the summary
- job registry: concurrent dedupe, concurrency cap, timeout, shutdown kill
- vault: summary round-trip, and staleness when `last_activity` advances
- parser: `ai-title` captured, and records still rejected when genuinely
  malformed

Web-side: `SessionSummary` renders each state, and a moment click resolves to the
matching `data-msg-uuid` node.
