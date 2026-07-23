# Session Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a cached prose summary and clickable key moments at the top of a historical agent session's transcript view.

**Architecture:** A `claude -p` subprocess summarizes a server-rendered digest of the session's messages into `{summary, moments[]}`, where each moment carries the uuid of a real transcript message. Results are cached in a new `agent_session_summaries` table and generated on first view only. Three guards keep the subprocess's own transcript from being ingested back into Forest.

**Tech Stack:** Bun + TypeScript + `bun:sqlite` (server, `bun test`), SolidJS + Vite (web, `vitest`).

**Spec:** `docs/superpowers/specs/2026-07-22-session-summaries-design.md`

---

## Background for the implementer

Forest scans Claude Code transcript files (JSONL, one JSON object per line) out of
`~/.claude*/projects/<slug>/<session-id>.jsonl` and ingests them into a SQLite
"vault" at `~/.local/share/forest/forest.db`. `server/src/sessions/vault.ts` wraps
that database; `server/src/sessions/parser.ts` turns one JSONL line into records.

The `agent_messages.content` column stores the **entire raw JSONL line**, not just
the message text. Anything that wants displayable text must `JSON.parse` the line
and walk `message.content`, which is either a string or an array of blocks
(`text`, `tool_use`, `tool_result`, `thinking`). The web side already does this in
`web/src/lib/transcript.ts`; this plan adds a smaller server-side equivalent.

**Two facts that were measured, not assumed** (details in the spec):

1. `claude -p` works, but the model returns its JSON wrapped in ` ```json ` fences.
2. Running `claude` writes a transcript that Forest will ingest unless stopped.

**Do not run `claude` in any test.** Every task uses an injected fake spawn.

---

## File Structure

**Create:**
- `server/src/sessions/summary-digest.ts` — messages → prompt-ready digest text + the set of uuids it contains
- `server/src/sessions/summary-parse.ts` — claude envelope → validated `{summary, moments}`
- `server/src/sessions/summarizer.ts` — job registry, spawn, timeout, concurrency
- `server/tests/summary-digest.test.ts`, `summary-parse.test.ts`, `summarizer.test.ts`, `vault-summaries.test.ts`
- `web/src/components/SessionSummary.tsx` — the summary block
- `web/tests/SessionSummary.test.tsx`

**Modify:**
- `server/src/store/db.ts` — `agent_session_summaries` table, `agent_sessions.title` column
- `server/src/sessions/parser.ts` — capture `ai-title`, drop the dead `summary` branch
- `server/src/sessions/scanner.ts` — pass titles through, exclude the summarizer cwd
- `server/src/sessions/vault.ts` — summary CRUD, digest source query, `title`, `uuid` in detail
- `server/src/sessions/hook-installer.ts` — `FOREST_INTERNAL` guard in the shim
- `server/src/routes/agent-sessions.ts` — two summary routes
- `server/src/index.ts` — construct and wire the summarizer
- `web/src/api.ts` — summary client + `uuid`/`title` on existing types
- `web/src/components/SessionTranscript.tsx` — mount the summary, anchor messages
- `web/src/styles.css` — summary block styling

---

## Task 1: Capture `ai-title`, drop the dead `summary` branch

Claude Code writes `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` lines. 144 of
334 local transcripts have one. `parseClaudeJsonlLine` rejects them at `parser.ts:113`
because they carry no `cwd`/`timestamp`. Rather than widen that function's return
union (which the scanner branches on), add a separate small parser beside it.

Also remove the `type === "summary"` branch at `parser.ts:202`: zero of the 334 local
transcripts contain such a record — it targets a format that no longer exists.

**Files:**
- Modify: `server/src/sessions/parser.ts`
- Test: `server/tests/parser.test.ts`
- Create: `server/tests/fixtures/claude-jsonl/ai-title.jsonl`

- [ ] **Step 1: Create the fixture**

Create `server/tests/fixtures/claude-jsonl/ai-title.jsonl` with exactly one line:

```json
{"type":"ai-title","aiTitle":"Sync claude.ai conversations","sessionId":"sid-test-1"}
```

- [ ] **Step 2: Write the failing tests**

Add to `server/tests/parser.test.ts`. Note the existing `fix()` helper at the top of
that file already resolves fixture paths — reuse it, and add `parseAiTitleLine` to
the existing import from `../src/sessions/parser`.

```ts
describe("parseAiTitleLine", () => {
  test("ai-title line → session id + title", () => {
    const out = parseAiTitleLine(fix("ai-title.jsonl"));
    expect(out).toEqual({ session_id: "sid-test-1", title: "Sync claude.ai conversations" });
  });

  test("a normal user line → null", () => {
    expect(parseAiTitleLine(fix("user-text.jsonl"))).toBeNull();
  });

  test("malformed line → null", () => {
    expect(parseAiTitleLine(fix("malformed.jsonl"))).toBeNull();
  });

  test("ai-title with a blank title → null", () => {
    expect(parseAiTitleLine('{"type":"ai-title","aiTitle":"   ","sessionId":"s1"}')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && bun test tests/parser.test.ts`
Expected: FAIL — `parseAiTitleLine is not a function` (or an import error).

- [ ] **Step 4: Implement `parseAiTitleLine`**

Add to `server/src/sessions/parser.ts`, after the `parseClaudeJsonlLine` function:

```ts
export type AiTitle = { session_id: string; title: string };

/**
 * Claude Code emits `{"type":"ai-title","aiTitle":…,"sessionId":…}` lines. They
 * carry no cwd/timestamp, so `parseClaudeJsonlLine` rejects them — this picks
 * them up separately. Returns null for every other kind of line.
 */
export function parseAiTitleLine(line: string): AiTitle | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw?.type !== "ai-title") return null;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const title = typeof raw.aiTitle === "string" ? raw.aiTitle.trim() : "";
  if (!sessionId || !title) return null;
  return { session_id: sessionId, title };
}
```

- [ ] **Step 5: Remove the dead `summary` branch**

In `server/src/sessions/parser.ts`, delete this block (currently at line 202):

```ts
  if (type === "summary" || type === "compact") {
    events.push({
      session_id: sessionId,
      kind: "compacted",
      timestamp: ts,
      payload: null,
    });
  }
```

and replace it with:

```ts
  if (type === "compact") {
    events.push({
      session_id: sessionId,
      kind: "compacted",
      timestamp: ts,
      payload: null,
    });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && bun test tests/parser.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add server/src/sessions/parser.ts server/tests/parser.test.ts server/tests/fixtures/claude-jsonl/ai-title.jsonl
git commit -m "feat(sessions): parse ai-title records from transcripts"
```

---

## Task 2: Store the title on the session row

**Files:**
- Modify: `server/src/store/db.ts`
- Modify: `server/src/sessions/vault.ts`
- Modify: `server/src/sessions/scanner.ts`
- Test: `server/tests/vault-summaries.test.ts` (created here, extended in Task 3)

- [ ] **Step 1: Write the failing test**

Create `server/tests/vault-summaries.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";

let db: Database;
let vault: Vault;

beforeEach(() => {
  db = openDb(":memory:");
  vault = new Vault(db);
});

function seedSession(sessionId: string, lastActivity = 1000): void {
  vault.upsertSession({
    session_id: sessionId,
    agent: "claude",
    cwd: "/proj",
    last_activity: lastActivity,
    source: "scan",
  });
}

describe("session title", () => {
  test("upsertSession stores a title", () => {
    seedSession("s1");
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", title: "Fix the parser",
    });
    expect(vault.getSession("s1")?.title).toBe("Fix the parser");
  });

  test("a later scan without a title does not erase the stored one", () => {
    seedSession("s1");
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", title: "Fix the parser",
    });
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 2000, source: "scan",
    });
    expect(vault.getSession("s1")?.title).toBe("Fix the parser");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: FAIL — `title` is not accepted by `upsertSession` / is undefined on the row.

- [ ] **Step 3: Add the column**

In `server/src/store/db.ts`, inside `openDb`, add alongside the existing
`addColumnIfMissing` calls:

```ts
  addColumnIfMissing(db, "agent_sessions", "title", "TEXT");
```

- [ ] **Step 4: Thread `title` through the vault**

In `server/src/sessions/vault.ts`:

Add to the `SessionRow` type (after `launched_via`):

```ts
  title: string | null;
```

In `upsertSession`, add to the input type after `launched_via?: string | null;`:

```ts
    title?: string | null;
```

In the same method's SQL, add `title` to the column list and one more `?` to the
`VALUES` list, then add to the `DO UPDATE SET` clause:

```sql
            title           = COALESCE(excluded.title, title)
```

and pass `input.title ?? null` as the matching parameter in `.run(...)`.

Then add `title` to the `SELECT` column list of **both** `getSession` and
`getSessionDetail`, and to `listByProject`, `searchByProject`, and `listAll` — grep
for `first_user_msg` in that file; every query selecting it needs `title` too.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: PASS.

- [ ] **Step 6: Feed titles in from the scanner**

In `server/src/sessions/scanner.ts`, import the new parser:

```ts
import { parseClaudeJsonlLine, parseAiTitleLine } from "./parser";
```

In `ingestJsonlFile`, declare a title accumulator next to the other accumulators:

```ts
  let aiTitle: string | null = null;
```

Inside the `for (const line of lines)` loop, **before** the `if (!out.ok) continue;`
line, add:

```ts
    const titleLine = parseAiTitleLine(line);
    if (titleLine) aiTitle = titleLine.title;
```

Then add `title: aiTitle,` to the `input.vault.upsertSession({...})` call.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/store/db.ts server/src/sessions/vault.ts server/src/sessions/scanner.ts server/tests/vault-summaries.test.ts
git commit -m "feat(sessions): store the transcript ai-title on the session row"
```

---

## Task 3: Summary storage in the vault

**Files:**
- Modify: `server/src/store/db.ts`
- Modify: `server/src/sessions/vault.ts`
- Test: `server/tests/vault-summaries.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/vault-summaries.test.ts`:

```ts
describe("summary storage", () => {
  test("putSummary then getSummary round-trips", () => {
    seedSession("s1");
    vault.putSummary({
      session_id: "s1", summary: "did a thing",
      moments: JSON.stringify([{ uuid: "u1", label: "start" }]),
      model: "claude-haiku-4-5-20251001", status: "ok", error: null,
      generated_at: 5000, source_last_activity: 1000, source_message_count: 12,
    });
    const row = vault.getSummary("s1")!;
    expect(row.status).toBe("ok");
    expect(row.summary).toBe("did a thing");
    expect(JSON.parse(row.moments)).toEqual([{ uuid: "u1", label: "start" }]);
    expect(row.source_message_count).toBe(12);
  });

  test("getSummary returns undefined when absent", () => {
    seedSession("s1");
    expect(vault.getSummary("s1")).toBeUndefined();
  });

  test("putSummary replaces an existing row", () => {
    seedSession("s1");
    const base = {
      session_id: "s1", moments: "[]", model: null,
      generated_at: 1, source_last_activity: 1, source_message_count: 1,
    };
    vault.putSummary({ ...base, summary: null, status: "error", error: "boom" });
    vault.putSummary({ ...base, summary: "ok now", status: "ok", error: null });
    expect(vault.getSummary("s1")!.status).toBe("ok");
    expect(vault.getSummary("s1")!.error).toBeNull();
  });

  test("deleting the session cascades the summary away", () => {
    seedSession("s1");
    vault.putSummary({
      session_id: "s1", summary: "x", moments: "[]", model: null,
      status: "ok", error: null, generated_at: 1,
      source_last_activity: 1, source_message_count: 1,
    });
    db.query("DELETE FROM agent_sessions WHERE session_id = ?").run("s1");
    expect(vault.getSummary("s1")).toBeUndefined();
  });

  test("countMessages counts stored messages", () => {
    seedSession("s1");
    vault.upsertMessages(
      [1, 2, 3].map((n) => ({
        session_id: "s1", uuid: `u${n}`, role: "user", content: "{}",
        timestamp: n, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null,
      })),
      [],
    );
    expect(vault.countMessages("s1")).toBe(3);
  });

  test("messagesForDigest returns uuid/role/content in timestamp order", () => {
    seedSession("s1");
    vault.upsertMessages(
      [
        { session_id: "s1", uuid: "u2", role: "assistant", content: "second", timestamp: 20,
          model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
          output_tokens: null, stop_reason: null },
        { session_id: "s1", uuid: "u1", role: "user", content: "first", timestamp: 10,
          model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
          output_tokens: null, stop_reason: null },
      ],
      [],
    );
    const rows = vault.messagesForDigest("s1");
    expect(rows.map((r) => r.uuid)).toEqual(["u1", "u2"]);
    expect(rows[0]!.content).toBe("first");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: FAIL — `vault.putSummary is not a function`.

- [ ] **Step 3: Add the table**

In `server/src/store/db.ts`, append to the `SCHEMA` template literal, after the
`tasks` indexes:

```sql
  CREATE TABLE IF NOT EXISTS agent_session_summaries (
    session_id            TEXT PRIMARY KEY
                            REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    summary               TEXT,
    moments               TEXT NOT NULL DEFAULT '[]',
    model                 TEXT,
    status                TEXT NOT NULL,
    error                 TEXT,
    generated_at          INTEGER NOT NULL,
    source_last_activity  INTEGER NOT NULL,
    source_message_count  INTEGER NOT NULL
  );
```

- [ ] **Step 4: Add the vault methods**

In `server/src/sessions/vault.ts`, add the type near `SessionRow`:

```ts
/** Only terminal outcomes are stored, so status is 'ok' or 'error' — never
 *  'pending'/'absent'/'skipped', which the API derives at request time. */
export type SummaryRow = {
  session_id: string;
  summary: string | null;
  moments: string; // JSON: Array<{uuid, label}>
  model: string | null;
  status: "ok" | "error";
  error: string | null;
  generated_at: number;
  source_last_activity: number;
  source_message_count: number;
};

export type DigestMessageRow = {
  uuid: string | null;
  role: string;
  content: string;
  timestamp: number;
};
```

Add these methods to the `Vault` class:

```ts
  getSummary(sessionId: string): SummaryRow | undefined {
    return this.db
      .query<SummaryRow, [string]>(
        `SELECT session_id, summary, moments, model, status, error,
                generated_at, source_last_activity, source_message_count
           FROM agent_session_summaries WHERE session_id = ?`,
      )
      .get(sessionId) ?? undefined;
  }

  putSummary(row: SummaryRow): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO agent_session_summaries (
            session_id, summary, moments, model, status, error,
            generated_at, source_last_activity, source_message_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id, row.summary, row.moments, row.model, row.status,
        row.error, row.generated_at, row.source_last_activity, row.source_message_count,
      );
  }

  countMessages(sessionId: string): number {
    return (
      this.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM agent_messages WHERE session_id = ?",
        )
        .get(sessionId)?.n ?? 0
    );
  }

  messagesForDigest(sessionId: string): DigestMessageRow[] {
    return this.db
      .query<DigestMessageRow, [string]>(
        `SELECT uuid, role, content, timestamp
           FROM agent_messages WHERE session_id = ?
          ORDER BY timestamp ASC, id ASC`,
      )
      .all(sessionId);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/store/db.ts server/src/sessions/vault.ts server/tests/vault-summaries.test.ts
git commit -m "feat(sessions): add agent_session_summaries storage"
```

---

## Task 4: Digest rendering

Turns stored messages into the text handed to the model, and reports which uuids
that text actually contains — the set used later to reject invented anchors.

**Files:**
- Create: `server/src/sessions/summary-digest.ts`
- Test: `server/tests/summary-digest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/summary-digest.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderDigest, buildPrompt } from "../src/sessions/summary-digest";

const line = (content: unknown, role = "user") =>
  JSON.stringify({ type: role, message: { role, content } });

const msg = (uuid: string | null, content: unknown, timestamp: number, role = "user") => ({
  uuid, role, content: line(content, role), timestamp,
});

describe("renderDigest", () => {
  test("renders one bracketed line per message and collects uuids", () => {
    const d = renderDigest([
      msg("u1", "hello there", 1),
      msg("u2", [{ type: "text", text: "hi back" }], 2, "assistant"),
    ]);
    expect(d.text).toContain("[u1] user: hello there");
    expect(d.text).toContain("[u2] assistant: hi back");
    expect([...d.uuids].sort()).toEqual(["u1", "u2"]);
    expect(d.includedCount).toBe(2);
  });

  test("tool calls render as name plus a short argument", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }], 1, "assistant"),
    ]);
    expect(d.text).toContain("<tool_use Bash bun test>");
  });

  test("tool results reduce to status and size, never their body", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_result", is_error: false, content: "x".repeat(5000) }], 1),
    ]);
    expect(d.text).toContain("<tool_result ok 5000b>");
    expect(d.text).not.toContain("xxxxxxxxxx");
  });

  test("errored tool results say error", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_result", is_error: true, content: "boom" }], 1),
    ]);
    expect(d.text).toContain("<tool_result error 4b>");
  });

  test("messages with no displayable text are dropped, uuid and all", () => {
    const d = renderDigest([
      { uuid: "u1", role: "permission-mode", content: '{"type":"permission-mode"}', timestamp: 1 },
      msg("u2", "real text", 2),
    ]);
    expect(d.uuids.has("u1")).toBe(false);
    expect(d.uuids.has("u2")).toBe(true);
    expect(d.includedCount).toBe(1);
  });

  test("messages without a uuid are dropped — they cannot be anchored", () => {
    const d = renderDigest([msg(null, "text with no uuid", 1)]);
    expect(d.includedCount).toBe(0);
  });

  test("a single huge message is clipped to the per-message cap", () => {
    const d = renderDigest([msg("u1", "y".repeat(5000), 1)]);
    expect(d.text.length).toBeLessThan(1400);
    expect(d.text).toContain("…");
  });

  test("over the total budget, head and tail are kept with an omission marker", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      msg(`u${i}`, `message number ${i} ` + "z".repeat(500), i),
    );
    const d = renderDigest(many);
    expect(d.text.length).toBeLessThanOrEqual(62_000);
    expect(d.text).toMatch(/… \d+ messages omitted …/);
    expect(d.text).toContain("[u0]");
    expect(d.text).toContain("[u399]");
    // dropped middle messages must not be citable
    expect(d.uuids.has("u200")).toBe(false);
    expect(d.uuids.has("u0")).toBe(true);
    expect(d.uuids.has("u399")).toBe(true);
  });

  test("under budget, nothing is omitted", () => {
    const d = renderDigest([msg("u1", "a", 1), msg("u2", "b", 2)]);
    expect(d.text).not.toContain("omitted");
  });
});

describe("buildPrompt", () => {
  test("includes the digest and demands verbatim uuids", () => {
    const p = buildPrompt("[u1] user: hi");
    expect(p).toContain("[u1] user: hi");
    expect(p).toContain("--- DIGEST ---");
    expect(p.toLowerCase()).toContain("uuid");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/summary-digest.test.ts`
Expected: FAIL — cannot resolve `../src/sessions/summary-digest`.

- [ ] **Step 3: Implement the digest**

Create `server/src/sessions/summary-digest.ts`:

```ts
import type { DigestMessageRow } from "./vault";

export type Digest = {
  /** The prompt-ready transcript text. */
  text: string;
  /** uuids actually present in `text` — the whitelist for anchor validation. */
  uuids: Set<string>;
  includedCount: number;
};

const PER_MESSAGE_MAX = 1200;
const TOTAL_MAX = 60_000;
const HEAD_FRACTION = 0.4;
const TOOL_ARG_MAX = 80;

function firstStringArg(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "query", "url", "description", "skill"]) {
    const v = i[key];
    if (typeof v === "string" && v.trim()) {
      const line = v.trim().split("\n")[0]!;
      return line.length > TOOL_ARG_MAX ? line.slice(0, TOOL_ARG_MAX) + "…" : line;
    }
  }
  return "";
}

function resultSize(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content === undefined || content === null) return 0;
  return JSON.stringify(content).length;
}

/**
 * Pull displayable text out of a stored JSONL line. Mirrors the frontend's
 * `parseMessageContent` filter so the model can only ever cite a message that
 * will have a DOM node to scroll to. Tool *results* are deliberately reduced to
 * status and size — their bodies are most of the token weight and none of the
 * meaning.
 */
export function displayText(rawLine: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return rawLine.trim();
  }
  if (!parsed || typeof parsed !== "object") return "";
  const content = (parsed as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      const t = b.text.trim();
      if (t) parts.push(t);
    } else if (b.type === "tool_use") {
      const arg = firstStringArg(b.input);
      parts.push(`<tool_use ${String(b.name ?? "tool")}${arg ? " " + arg : ""}>`);
    } else if (b.type === "tool_result") {
      parts.push(`<tool_result ${b.is_error === true ? "error" : "ok"} ${resultSize(b.content)}b>`);
    }
    // thinking / redacted_thinking and unknown blocks are dropped
  }
  return parts.join("\n").trim();
}

export function renderDigest(messages: DigestMessageRow[]): Digest {
  const lines: Array<{ uuid: string; line: string }> = [];
  for (const m of messages) {
    if (!m.uuid) continue; // unanchorable
    const text = displayText(m.content);
    if (!text) continue;
    const clipped = text.length > PER_MESSAGE_MAX ? text.slice(0, PER_MESSAGE_MAX) + "…" : text;
    lines.push({ uuid: m.uuid, line: `[${m.uuid}] ${m.role}: ${clipped}` });
  }

  const total = lines.reduce((n, l) => n + l.line.length + 1, 0);
  let kept = lines;

  if (total > TOTAL_MAX) {
    const headBudget = Math.floor(TOTAL_MAX * HEAD_FRACTION);
    const head: typeof lines = [];
    let used = 0;
    for (const l of lines) {
      if (used + l.line.length + 1 > headBudget) break;
      head.push(l);
      used += l.line.length + 1;
    }
    const tail: typeof lines = [];
    used = 0;
    for (let i = lines.length - 1; i >= head.length; i--) {
      const l = lines[i]!;
      if (used + l.line.length + 1 > TOTAL_MAX - headBudget) break;
      tail.unshift(l);
      used += l.line.length + 1;
    }
    const omitted = lines.length - head.length - tail.length;
    kept = omitted > 0
      ? [...head, { uuid: "", line: `… ${omitted} messages omitted …` }, ...tail]
      : [...head, ...tail];
  }

  const uuids = new Set(kept.map((l) => l.uuid).filter((u) => u.length > 0));
  return { text: kept.map((l) => l.line).join("\n"), uuids, includedCount: uuids.size };
}

export function buildPrompt(digest: string): string {
  return [
    "Summarize this Claude Code session transcript digest.",
    "",
    "Return ONLY JSON matching this shape, with no prose around it:",
    '{"summary":"2-4 sentences of plain past-tense prose","moments":[{"uuid":"<copied verbatim from a [bracket] in the digest>","label":"short phrase, max 60 chars"}]}',
    "",
    "Give 3-6 moments covering the turning points: what was asked, key decisions,",
    "corrections, and the outcome. Order them as they appear in the digest.",
    "Every uuid MUST be copied exactly from a [bracket] in the digest. Never invent one.",
    "",
    "--- DIGEST ---",
    digest,
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/summary-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/summary-digest.ts server/tests/summary-digest.test.ts
git commit -m "feat(sessions): render transcript digests for summarization"
```

---

## Task 5: Output parsing and anchor validation

Two layers: unwrap Claude's `--output-format json` envelope, then parse the model's
own JSON out of it — which arrives fence-wrapped in practice.

**Files:**
- Create: `server/src/sessions/summary-parse.ts`
- Test: `server/tests/summary-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/summary-parse.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { stripFences, parseSummaryOutput, resultTextFromEnvelope } from "../src/sessions/summary-parse";

const valid = new Set(["u1", "u2", "u3"]);

describe("stripFences", () => {
  test("removes ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test("removes bare ``` fences", () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test("leaves unfenced text alone", () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("resultTextFromEnvelope", () => {
  test("extracts .result from a success envelope", () => {
    const out = resultTextFromEnvelope(JSON.stringify({ subtype: "success", is_error: false, result: "hello" }));
    expect(out).toEqual({ ok: true, text: "hello" });
  });
  test("is_error true → failure carrying the message", () => {
    const out = resultTextFromEnvelope(JSON.stringify({ is_error: true, result: "Not logged in" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("Not logged in");
  });
  test("non-JSON stdout → failure", () => {
    expect(resultTextFromEnvelope("segfault").ok).toBe(false);
  });
  test("empty result text → failure", () => {
    expect(resultTextFromEnvelope(JSON.stringify({ result: "   " })).ok).toBe(false);
  });
});

describe("parseSummaryOutput", () => {
  test("parses fenced JSON and keeps valid anchors", () => {
    const raw = '```json\n{"summary":"did things","moments":[{"uuid":"u1","label":"start"},{"uuid":"u2","label":"end"}]}\n```';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("did things");
    expect(out.moments).toEqual([{ uuid: "u1", label: "start" }, { uuid: "u2", label: "end" }]);
  });

  test("drops moments whose uuid is not in the digest", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"real"},{"uuid":"nope","label":"invented"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([{ uuid: "u1", label: "real" }]);
  });

  test("all anchors invalid → summary survives with zero moments", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"x","label":"a"},{"uuid":"y","label":"b"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });

  test("duplicate uuids are collapsed", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"a"},{"uuid":"u1","label":"b"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toHaveLength(1);
  });

  test("moments with a blank label are dropped", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"  "}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });

  test("garbage → failure", () => {
    expect(parseSummaryOutput("I'm afraid I can't do that", valid).ok).toBe(false);
  });

  test("missing summary → failure", () => {
    expect(parseSummaryOutput('{"moments":[]}', valid).ok).toBe(false);
  });

  test("missing moments key → summary with zero moments", () => {
    const out = parseSummaryOutput('{"summary":"s"}', valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/summary-parse.test.ts`
Expected: FAIL — cannot resolve `../src/sessions/summary-parse`.

- [ ] **Step 3: Implement the parser**

Create `server/src/sessions/summary-parse.ts`:

```ts
export type Moment = { uuid: string; label: string };

export type SummaryParse =
  | { ok: true; summary: string; moments: Moment[] }
  | { ok: false; reason: string };

export type EnvelopeParse = { ok: true; text: string } | { ok: false; reason: string };

const LABEL_MAX = 80;

/** Haiku fence-wraps its JSON despite being told not to — measured, not assumed. */
export function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1]!.trim() : t;
}

/** Unwrap `claude --output-format json`'s envelope to the model's own text. */
export function resultTextFromEnvelope(stdout: string): EnvelopeParse {
  let env: unknown;
  try {
    env = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "claude did not return JSON" };
  }
  if (!env || typeof env !== "object") return { ok: false, reason: "claude did not return JSON" };
  const e = env as Record<string, unknown>;
  const text = typeof e.result === "string" ? e.result : "";
  if (e.is_error === true) {
    return { ok: false, reason: text.trim() || "claude reported an error" };
  }
  if (!text.trim()) return { ok: false, reason: "claude returned no result text" };
  return { ok: true, text };
}

/**
 * Parse the model's JSON and drop any anchor it did not copy from the digest.
 * This is the guard against hallucinated uuids: a moment survives only if its
 * uuid is in `validUuids`.
 */
export function parseSummaryOutput(raw: string, validUuids: Set<string>): SummaryParse {
  let obj: unknown;
  try {
    obj = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, reason: "model output was not JSON" };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "model output was not an object" };
  const o = obj as Record<string, unknown>;

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return { ok: false, reason: "model output had no summary" };

  const moments: Moment[] = [];
  if (Array.isArray(o.moments)) {
    for (const entry of o.moments) {
      if (!entry || typeof entry !== "object") continue;
      const m = entry as Record<string, unknown>;
      const uuid = typeof m.uuid === "string" ? m.uuid.trim() : "";
      const label = typeof m.label === "string" ? m.label.trim() : "";
      if (!uuid || !label) continue;
      if (!validUuids.has(uuid)) continue;
      if (moments.some((x) => x.uuid === uuid)) continue;
      moments.push({ uuid, label: label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) + "…" : label });
    }
  }
  return { ok: true, summary, moments };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/summary-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/summary-parse.ts server/tests/summary-parse.test.ts
git commit -m "feat(sessions): parse and validate summarizer output"
```

---

## Task 6: Pollution guards

Two of the three guards from the spec. Guard three (the neutral cwd) needs no code
beyond the summarizer passing it, which happens in Task 7.

The scanner guard uses an **exact cwd match**, not a slug-name guess: Claude's
directory-slug algorithm is an implementation detail we should not depend on, and
`ingestJsonlFile` already knows the parsed `cwd`.

**Files:**
- Modify: `server/src/sessions/hook-installer.ts`
- Modify: `server/src/sessions/scanner.ts`
- Test: `server/tests/hook-installer.test.ts`
- Test: `server/tests/scanner-summarizer-exclusion.test.ts`

- [ ] **Step 1: Write the failing hook test**

Add to `server/tests/hook-installer.test.ts`:

```ts
test("shim short-circuits when FOREST_INTERNAL is set", () => {
  installHooks({ dataDir: tmp, configDirs: [{ path: join(tmp, "claude"), profile: "default" }], port: 52810 });
  const shim = readFileSync(join(tmp, "bin", "forest-ingest"), "utf8");
  expect(shim).toContain("FOREST_INTERNAL");
  // the guard must come before the curl that reports the event
  expect(shim.indexOf("FOREST_INTERNAL")).toBeLessThan(shim.indexOf("curl"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test tests/hook-installer.test.ts`
Expected: FAIL — shim does not contain `FOREST_INTERNAL`.

- [ ] **Step 3: Add the guard to the shim**

In `server/src/sessions/hook-installer.ts`, in `shimContent`, insert immediately
after the `${FOREST_MARKER}` line:

```bash
# Forest's own summarizer runs claude headlessly; its events are not user sessions.
if [ -n "\${FOREST_INTERNAL:-}" ]; then exit 0; fi
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && bun test tests/hook-installer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing scanner test**

Create `server/tests/scanner-summarizer-exclusion.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd server && bun test tests/scanner-summarizer-exclusion.test.ts`
Expected: FAIL — `skip-me` is ingested (`excludeCwd` is ignored).

- [ ] **Step 7: Implement the exclusion**

In `server/src/sessions/scanner.ts`, add to the `ScanInput` type:

```ts
  /** Absolute cwd whose transcripts are Forest's own (the summarizer) and must
   *  never be ingested. Matched exactly — Claude's dir-slug format is internal. */
  excludeCwd?: string;
```

In `ingestJsonlFile`, immediately after `const cwd = firstSession.session.cwd;`, add:

```ts
  if (input.excludeCwd && cwd === input.excludeCwd) return;
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd server && bun test tests/scanner-summarizer-exclusion.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/sessions/hook-installer.ts server/src/sessions/scanner.ts server/tests/hook-installer.test.ts server/tests/scanner-summarizer-exclusion.test.ts
git commit -m "feat(sessions): keep Forest's own claude runs out of the vault"
```

---

## Task 7: The summarizer

`Bun.spawn` execs a binary from `PATH` directly — it never sources a shell, so the
multi-agent-profiles `claude` **shell function** that aborts non-interactively is
not in play. Passing `"claude"` is correct and matches `AgentRunner`.

**Files:**
- Create: `server/src/sessions/summarizer.ts`
- Test: `server/tests/summarizer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/summarizer.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { SessionSummarizer, type SummarizerSpawnFn } from "../src/sessions/summarizer";

let db: Database;
let vault: Vault;

beforeEach(() => {
  db = openDb(":memory:");
  vault = new Vault(db);
});

function envelope(result: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result });
}

/** Resolves immediately with a canned stdout. */
function fakeSpawn(stdout: string, code = 0): SummarizerSpawnFn & { calls: Array<{ cmd: string[]; cwd: string; env: Record<string, string> }> } {
  const calls: Array<{ cmd: string[]; cwd: string; env: Record<string, string> }> = [];
  const fn = ((opts) => {
    calls.push(opts);
    return { exited: Promise.resolve({ code, stdout, stderr: "" }), kill: () => {} };
  }) as SummarizerSpawnFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

/** Never resolves until `release()` is called. */
function blockingSpawn() {
  let release!: (v: { code: number; stdout: string; stderr: string }) => void;
  const gate = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { release = r; });
  let killed = 0;
  const calls: unknown[] = [];
  const fn: SummarizerSpawnFn = (opts) => {
    calls.push(opts);
    return { exited: gate, kill: () => { killed++; } };
  };
  return { fn, release, killed: () => killed, count: () => calls.length };
}

function seed(sessionId: string, messageCount: number, lastActivity = 1000): void {
  vault.upsertSession({
    session_id: sessionId, agent: "claude", cwd: "/proj",
    last_activity: lastActivity, source: "scan", profile: "default",
  });
  vault.upsertMessages(
    Array.from({ length: messageCount }, (_, i) => ({
      session_id: sessionId, uuid: `u${i}`, role: i % 2 ? "assistant" : "user",
      content: JSON.stringify({ type: "user", message: { role: "user", content: `message ${i}` } }),
      timestamp: i, model: null, input_tokens: null, cache_create_tokens: null,
      cache_read_tokens: null, output_tokens: null, stop_reason: null,
    })),
    [],
  );
}

function make(spawn: SummarizerSpawnFn, over: Partial<ConstructorParameters<typeof SessionSummarizer>[0]> = {}) {
  return new SessionSummarizer({
    vault,
    dataDir: "/data",
    claudeConfigDirs: () => [{ path: "/home/u/.claude", profile: "default" }],
    spawn,
    now: () => 5000,
    ...over,
  });
}

describe("status", () => {
  test("unknown session → absent", () => {
    expect(make(fakeSpawn("")).status("nope").status).toBe("absent");
  });

  test("too few messages → skipped", () => {
    seed("s1", 2);
    expect(make(fakeSpawn("")).status("s1").status).toBe("skipped");
  });

  test("no stored summary → absent", () => {
    seed("s1", 10);
    expect(make(fakeSpawn("")).status("s1").status).toBe("absent");
  });

  test("stored ok row → ready with summary and moments", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope('{"summary":"it happened","moments":[{"uuid":"u1","label":"first"}]}')));
    await s.request("s1");
    const st = s.status("s1");
    expect(st.status).toBe("ready");
    expect(st.summary).toBe("it happened");
    expect(st.moments).toEqual([{ uuid: "u1", label: "first" }]);
    expect(st.stale).toBe(false);
  });

  test("session resumed after summarizing → stale", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope('{"summary":"x","moments":[]}')));
    await s.request("s1");
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 99_999, source: "scan",
    });
    expect(s.status("s1").stale).toBe(true);
  });
});

describe("request", () => {
  test("spawns claude with the designed flags, cwd, and env", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    await make(spawn).request("s1");
    const call = spawn.calls[0]!;
    expect(call.cmd[0]).toBe("claude");
    expect(call.cmd).toContain("-p");
    expect(call.cmd).toContain("--output-format");
    expect(call.cmd).toContain("json");
    expect(call.cmd).toContain("--allowed-tools");
    expect(call.cmd).toContain("claude-haiku-4-5-20251001");
    expect(call.cwd).toBe("/data/summarizer");
    expect(call.env.FOREST_INTERNAL).toBe("1");
    expect(call.env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude");
  });

  test("borrows the config dir matching the session's profile", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "work",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    await make(spawn, {
      claudeConfigDirs: () => [
        { path: "/home/u/.claude", profile: "default" },
        { path: "/home/u/.claude-work", profile: "work" },
      ],
    }).request("s1");
    expect(spawn.calls[0]!.env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-work");
  });

  test("an unknown profile falls back to the first config dir", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "ghost",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    await make(spawn).request("s1");
    expect(spawn.calls[0]!.env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude");
  });

  test("too few messages → skipped, nothing spawned", async () => {
    seed("s1", 2);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    expect((await make(spawn).request("s1")).status).toBe("skipped");
    expect(spawn.calls).toHaveLength(0);
  });

  test("a cached summary is not regenerated", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.request("s1");
    expect(spawn.calls).toHaveLength(1);
  });

  test("force regenerates", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.request("s1", { force: true });
    expect(spawn.calls).toHaveLength(2);
  });

  test("a non-zero exit is stored as an error and not retried", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn("", 1);
    const s = make(spawn);
    await s.request("s1");
    expect(s.status("s1").status).toBe("error");
    await s.request("s1");
    expect(spawn.calls).toHaveLength(1);
  });

  test("unparseable model output is stored as an error", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope("sorry, I cannot")));
    await s.request("s1");
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("JSON");
  });

  test("invented anchors are dropped, the summary survives", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope('{"summary":"kept","moments":[{"uuid":"made-up","label":"nope"}]}')));
    await s.request("s1");
    const st = s.status("s1");
    expect(st.status).toBe("ready");
    expect(st.summary).toBe("kept");
    expect(st.moments).toEqual([]);
  });
});

describe("job control", () => {
  test("a second request while running does not spawn twice", async () => {
    seed("s1", 10);
    const b = blockingSpawn();
    const s = make(b.fn);
    const first = s.request("s1");
    expect((await s.request("s1")).status).toBe("pending");
    expect(b.count()).toBe(1);
    b.release({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" });
    await first;
  });

  test("concurrency is capped", async () => {
    seed("s1", 10); seed("s2", 10); seed("s3", 10);
    const b = blockingSpawn();
    const s = make(b.fn, { maxConcurrent: 2 });
    void s.request("s1"); void s.request("s2"); void s.request("s3");
    await Promise.resolve();
    expect(b.count()).toBe(2);
  });

  test("shutdown kills running children", async () => {
    seed("s1", 10);
    const b = blockingSpawn();
    const s = make(b.fn);
    void s.request("s1");
    await Promise.resolve();
    s.shutdown();
    expect(b.killed()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/summarizer.test.ts`
Expected: FAIL — cannot resolve `../src/sessions/summarizer`.

- [ ] **Step 3: Implement the summarizer**

Create `server/src/sessions/summarizer.ts`:

```ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readdirSync, rmSync, existsSync } from "node:fs";
import type { Vault } from "./vault";
import type { ClaudeConfigDir } from "./config-dirs";
import { renderDigest, buildPrompt } from "./summary-digest";
import { parseSummaryOutput, resultTextFromEnvelope, type Moment } from "./summary-parse";

export type SummarizerProc = {
  exited: Promise<{ code: number; stdout: string; stderr: string }>;
  kill(signal?: string): void;
};

export type SummarizerSpawnFn = (opts: {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}) => SummarizerProc;

export const bunSummarizerSpawn: SummarizerSpawnFn = ({ cmd, cwd, env }) => {
  const proc = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return {
    exited: (async () => {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    })(),
    kill: (sig?: string) => proc.kill(sig as never),
  };
};

export type SummaryStatus = {
  status: "ready" | "pending" | "error" | "absent" | "skipped";
  summary?: string;
  moments?: Moment[];
  model?: string | null;
  generatedAt?: number;
  stale?: boolean;
  error?: string | null;
};

type Logger = (level: string, msg: string, meta?: Record<string, unknown>) => void;

export type SummarizerDeps = {
  vault: Vault;
  dataDir: string;
  claudeConfigDirs: () => ClaudeConfigDir[];
  spawn?: SummarizerSpawnFn;
  claudeBin?: string;
  model?: string;
  now?: () => number;
  timeoutMs?: number;
  maxConcurrent?: number;
  log?: Logger;
};

/** Below this, a summary costs more than it is worth. */
const MIN_MESSAGES = 4;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_CONCURRENT = 2;

export class SessionSummarizer {
  private readonly spawnFn: SummarizerSpawnFn;
  private readonly claudeBin: string;
  private readonly model: string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly log: Logger;

  private readonly running = new Map<string, SummarizerProc>();
  private readonly queue: Array<{ sessionId: string; run: () => void }> = [];

  constructor(private readonly deps: SummarizerDeps) {
    this.spawnFn = deps.spawn ?? bunSummarizerSpawn;
    this.claudeBin = deps.claudeBin ?? "claude";
    this.model = deps.model ?? DEFAULT_MODEL;
    this.now = deps.now ?? (() => Date.now());
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.log = deps.log ?? (() => {});
  }

  /** The directory summarizer runs execute in — outside any scanned project, so
   *  their own transcripts classify with a null project_id. */
  summarizerCwd(): string {
    return join(this.deps.dataDir, "summarizer");
  }

  status(sessionId: string): SummaryStatus {
    if (this.running.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    const row = this.deps.vault.getSummary(sessionId);
    if (!row) {
      return this.deps.vault.countMessages(sessionId) < MIN_MESSAGES
        ? { status: "skipped" }
        : { status: "absent" };
    }

    if (row.status === "error") {
      return { status: "error", error: row.error, generatedAt: row.generated_at };
    }

    const stale =
      row.source_last_activity < session.last_activity ||
      row.source_message_count < this.deps.vault.countMessages(sessionId);

    let moments: Moment[] = [];
    try {
      moments = JSON.parse(row.moments) as Moment[];
    } catch {
      moments = [];
    }

    return {
      status: "ready",
      summary: row.summary ?? "",
      moments,
      model: row.model,
      generatedAt: row.generated_at,
      stale,
    };
  }

  async request(sessionId: string, opts: { force?: boolean } = {}): Promise<SummaryStatus> {
    if (this.running.has(sessionId)) return { status: "pending" };

    const session = this.deps.vault.getSession(sessionId);
    if (!session) return { status: "absent" };

    const existing = this.deps.vault.getSummary(sessionId);
    if (existing && !opts.force) return this.status(sessionId);

    const messages = this.deps.vault.messagesForDigest(sessionId);
    const digest = renderDigest(messages);
    if (digest.includedCount < MIN_MESSAGES) return { status: "skipped" };

    const configDirs = this.deps.claudeConfigDirs();
    const configDir =
      configDirs.find((c) => c.profile === session.profile)?.path ?? configDirs[0]?.path;
    const messageCount = this.deps.vault.countMessages(sessionId);
    if (!configDir) {
      return this.store(sessionId, session.last_activity, messageCount, {
        ok: false, reason: "no claude config dir available",
      });
    }

    await this.run(sessionId, {
      prompt: buildPrompt(digest.text),
      uuids: digest.uuids,
      configDir,
      lastActivity: session.last_activity,
      messageCount,
    });
    return this.status(sessionId);
  }

  shutdown(): void {
    for (const proc of this.running.values()) {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
    this.running.clear();
    this.queue.length = 0;
  }

  private async run(
    sessionId: string,
    args: { prompt: string; uuids: Set<string>; configDir: string; lastActivity: number; messageCount: number },
  ): Promise<void> {
    if (this.running.size >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push({ sessionId, run: resolve }));
    }

    const runId = randomUUID();
    let proc: SummarizerProc;
    try {
      proc = this.spawnFn({
        cmd: [
          this.claudeBin, "-p", args.prompt,
          "--session-id", runId,
          "--model", this.model,
          "--output-format", "json",
          "--allowed-tools", "",
        ],
        cwd: this.summarizerCwd(),
        env: {
          ...(process.env as Record<string, string>),
          CLAUDE_CONFIG_DIR: args.configDir,
          FOREST_INTERNAL: "1",
        },
      });
    } catch (err) {
      this.store(sessionId, args.lastActivity, args.messageCount, {
        ok: false, reason: `failed to start claude: ${(err as Error).message}`,
      });
      this.drain();
      return;
    }

    this.running.set(sessionId, proc);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }, this.timeoutMs);

    try {
      const { code, stdout, stderr } = await proc.exited;
      if (timedOut) {
        this.store(sessionId, args.lastActivity, args.messageCount, {
          ok: false, reason: `summarizer timed out after ${Math.round(this.timeoutMs / 1000)}s`,
        });
      } else if (code !== 0) {
        this.store(sessionId, args.lastActivity, args.messageCount, {
          ok: false, reason: stderr.trim().slice(0, 500) || `claude exited ${code}`,
        });
      } else {
        const envelope = resultTextFromEnvelope(stdout);
        this.store(
          sessionId, args.lastActivity, args.messageCount,
          envelope.ok ? parseSummaryOutput(envelope.text, args.uuids) : envelope,
        );
      }
    } catch (err) {
      this.store(sessionId, args.lastActivity, args.messageCount, {
        ok: false, reason: (err as Error).message,
      });
    } finally {
      clearTimeout(timer);
      this.running.delete(sessionId);
      this.cleanupTranscript(args.configDir, runId);
      this.drain();
    }
  }

  private drain(): void {
    while (this.running.size < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) return;
      next.run();
    }
  }

  /** Belt to the scanner's braces: delete the transcript this run wrote. Matched
   *  by filename (the run id) so we never depend on Claude's dir-slug format. */
  private cleanupTranscript(configDir: string, runId: string): void {
    const projects = join(configDir, "projects");
    if (!existsSync(projects)) return;
    try {
      for (const dir of readdirSync(projects, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const candidate = join(projects, dir.name, `${runId}.jsonl`);
        if (existsSync(candidate)) {
          rmSync(candidate, { force: true });
          return;
        }
      }
    } catch (err) {
      this.log("warn", "summarizer: transcript cleanup failed", { error: (err as Error).message });
    }
  }

  private store(
    sessionId: string,
    lastActivity: number,
    messageCount: number,
    result: { ok: true; summary: string; moments: Moment[] } | { ok: false; reason: string },
  ): SummaryStatus {
    this.deps.vault.putSummary({
      session_id: sessionId,
      summary: result.ok ? result.summary : null,
      moments: JSON.stringify(result.ok ? result.moments : []),
      model: result.ok ? this.model : null,
      status: result.ok ? "ok" : "error",
      error: result.ok ? null : result.reason,
      generated_at: this.now(),
      source_last_activity: lastActivity,
      source_message_count: messageCount,
    });
    if (!result.ok) this.log("warn", "summarizer failed", { sessionId, reason: result.reason });
    return this.status(sessionId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/summarizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions/summarizer.ts server/tests/summarizer.test.ts
git commit -m "feat(sessions): add the session summarizer job runner"
```

---

## Task 8: API routes and server wiring

**Files:**
- Modify: `server/src/routes/agent-sessions.ts`
- Modify: `server/src/index.ts`
- Test: `server/tests/routes-summaries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/routes-summaries.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { agentSessionsRoutes } from "../src/routes/agent-sessions";
import type { SummaryStatus } from "../src/sessions/summarizer";

let vault: Vault;

beforeEach(() => {
  vault = new Vault(openDb(":memory:"));
});

const stub = {
  status: (): SummaryStatus => ({ status: "ready", summary: "cached", moments: [], stale: false }),
  request: async (_sid: string, opts?: { force?: boolean }): Promise<SummaryStatus> =>
    ({ status: opts?.force ? "ready" : "pending" }),
};

function routes(summarizer: unknown = stub) {
  return agentSessionsRoutes({
    vault,
    listProjects: () => [],
    claudeConfigDirs: () => [],
    summarizer: summarizer as never,
  });
}

function find(method: string, path: string) {
  const route = routes().find((r) => r.method === method && r.pattern.test(path));
  if (!route) throw new Error(`no ${method} route for ${path}`);
  return route;
}

describe("summary routes", () => {
  test("GET is matched by the summary pattern, not the :sid catch-all", () => {
    const all = routes().filter((r) => r.method === "GET" && r.pattern.test("/api/agent-sessions/s1/summary"));
    expect(all.length).toBeGreaterThan(0);
    // the summary route must be registered before the bare /:sid route
    const idx = routes().findIndex((r) => r.method === "GET" && r.pattern.source.includes("summary"));
    const catchAll = routes().findIndex(
      (r) => r.method === "GET" && r.pattern.source === "^\\/api\\/agent-sessions\\/([^/]+)$",
    );
    expect(idx).toBeLessThan(catchAll);
  });

  test("GET returns the stored status", async () => {
    const route = find("GET", "/api/agent-sessions/s1/summary");
    const res = await route.handler({
      params: { sid: "s1" },
      url: new URL("http://x/api/agent-sessions/s1/summary"),
      request: new Request("http://x/api/agent-sessions/s1/summary"),
      db: null as never,
      log: () => {},
    } as never);
    expect(await res.json()).toMatchObject({ status: "ready", summary: "cached" });
  });

  test("POST enqueues and returns pending", async () => {
    const route = find("POST", "/api/agent-sessions/s1/summary");
    const res = await route.handler({
      params: { sid: "s1" },
      url: new URL("http://x/api/agent-sessions/s1/summary"),
      request: new Request("http://x/api/agent-sessions/s1/summary", { method: "POST", body: "{}" }),
      db: null as never,
      log: () => {},
    } as never);
    expect(await res.json()).toMatchObject({ status: "pending" });
  });

  test("POST honours force", async () => {
    const route = find("POST", "/api/agent-sessions/s1/summary");
    const res = await route.handler({
      params: { sid: "s1" },
      url: new URL("http://x/api/agent-sessions/s1/summary"),
      request: new Request("http://x/api/agent-sessions/s1/summary", {
        method: "POST", body: JSON.stringify({ force: true }),
      }),
      db: null as never,
      log: () => {},
    } as never);
    expect(await res.json()).toMatchObject({ status: "ready" });
  });

  test("without a summarizer, GET reports absent", async () => {
    const route = agentSessionsRoutes({ vault, listProjects: () => [], claudeConfigDirs: () => [] })
      .find((r) => r.method === "GET" && r.pattern.source.includes("summary"))!;
    const res = await route.handler({
      params: { sid: "s1" },
      url: new URL("http://x/api/agent-sessions/s1/summary"),
      request: new Request("http://x/api/agent-sessions/s1/summary"),
      db: null as never,
      log: () => {},
    } as never);
    expect(await res.json()).toMatchObject({ status: "absent" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/routes-summaries.test.ts`
Expected: FAIL — no route matches `/api/agent-sessions/s1/summary`.

- [ ] **Step 3: Add the routes**

In `server/src/routes/agent-sessions.ts`, add the import:

```ts
import type { SessionSummarizer } from "../sessions/summarizer";
```

Add to `RouteDeps`:

```ts
  summarizer?: SessionSummarizer;
```

Insert these two routes **immediately before** the final
`/^\/api\/agent-sessions\/([^/]+)$/` route — that pattern would otherwise swallow
`summary`, exactly as the comment on the `live` route warns:

```ts
    {
      // IMPORTANT: must be registered before the /api/agent-sessions/:sid route
      // below — `([^/]+)` would otherwise match `s1/summary`'s first segment only
      // after this more specific pattern has had its chance.
      method: "GET",
      pattern: /^\/api\/agent-sessions\/([^/]+)\/summary$/,
      paramNames: ["sid"],
      handler: (ctx) =>
        json(deps.summarizer ? deps.summarizer.status(ctx.params.sid!) : { status: "absent" }),
    },
    {
      method: "POST",
      pattern: /^\/api\/agent-sessions\/([^/]+)\/summary$/,
      paramNames: ["sid"],
      handler: async (ctx) => {
        if (!deps.summarizer) return json({ status: "absent" });
        const body = (await ctx.request.json().catch(() => null)) as { force?: boolean } | null;
        return json(await deps.summarizer.request(ctx.params.sid!, { force: body?.force === true }));
      },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/routes-summaries.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the server**

In `server/src/index.ts`:

Add the import beside the `AgentRunner` import:

```ts
import { SessionSummarizer } from "./sessions/summarizer";
```

After the `const runner = new AgentRunner({...});` block, add:

```ts
const summarizer = new SessionSummarizer({
  vault,
  dataDir: dataDir(),
  claudeConfigDirs: configDirs,
  log,
});
mkdirSync(summarizer.summarizerCwd(), { recursive: true });
```

In `shutdown()`, add the summarizer alongside the runner:

```ts
function shutdown(): void {
  try { runner.shutdown(); } catch { /* ignore */ }
  try { summarizer.shutdown(); } catch { /* ignore */ }
}
```

In `scanAllProfiles`, add the exclusion so the scanner skips the summarizer's own
transcripts:

```ts
    excludeCwd: summarizer.summarizerCwd(),
```

In the `agentSessionsRoutes({...})` call, add:

```ts
      summarizer,
```

Also add `excludeCwd: summarizer.summarizerCwd(),` to the `scanClaudeProjects` call
inside `server/src/routes/agent-sessions.ts`'s ingest handler — add
`summarizerCwd?: () => string;` to `RouteDeps`, pass
`excludeCwd: deps.summarizerCwd?.()` there, and supply
`summarizerCwd: () => summarizer.summarizerCwd(),` from `index.ts`.

- [ ] **Step 6: Run the full server suite and boot the server**

Run: `cd server && bun test`
Expected: PASS.

Run: `bun run dev:server` then, in another shell,
`curl -s localhost:52810/api/health`
Expected: `{"ok":true,...}`. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/agent-sessions.ts server/src/index.ts server/tests/routes-summaries.test.ts
git commit -m "feat(sessions): expose session summary routes"
```

---

## Task 9: Expose `uuid` and `title` to the web client

Anchoring needs each rendered message to know its uuid. `getSessionDetail` does not
currently select it even though `agent_messages` stores it.

**Files:**
- Modify: `server/src/sessions/vault.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/components/SessionTranscript.tsx`
- Test: `server/tests/vault-summaries.test.ts`
- Test: `web/tests/SessionTranscript.test.tsx`

- [ ] **Step 1: Write the failing server test**

Append to `server/tests/vault-summaries.test.ts`:

```ts
describe("getSessionDetail", () => {
  test("includes each message's uuid so the UI can anchor to it", () => {
    seedSession("s1");
    vault.upsertMessages(
      [{ session_id: "s1", uuid: "u-anchor", role: "user", content: "{}", timestamp: 1,
         model: null, input_tokens: null, cache_create_tokens: null,
         cache_read_tokens: null, output_tokens: null, stop_reason: null }],
      [],
    );
    expect(vault.getSessionDetail("s1")!.messages[0]!.uuid).toBe("u-anchor");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: FAIL — `uuid` is undefined.

- [ ] **Step 3: Select `uuid` in the detail query**

In `server/src/sessions/vault.ts`, in `getSessionDetail`, change the messages query's
column list from `SELECT id, role, content, timestamp, model,` to:

```sql
        `SELECT id, uuid, role, content, timestamp, model,
```

Add `uuid: string | null;` to the `messages` element type in the `SessionDetail` type
declaration (grep for `messages: Array<{` in that file).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && bun test tests/vault-summaries.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing web test**

Add to `web/tests/SessionTranscript.test.tsx`:

```tsx
test("each rendered message carries its uuid for anchoring", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s4", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u-anchor", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"anchor me"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });
  const { container } = render(() => <SessionTranscript sessionId="s4" onResume={() => {}} />);
  await waitFor(() => container.textContent?.includes("anchor me"));
  expect(container.querySelector('[data-msg-uuid="u-anchor"]')).not.toBeNull();
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd web && bun run test -- SessionTranscript`
Expected: FAIL — no element with `data-msg-uuid`.

- [ ] **Step 7: Add the types and the attribute**

In `web/src/api.ts`, add to `AgentSessionRow` (after `profile`):

```ts
  title: string | null;
```

and add `uuid: string | null;` to the `messages` element type in `AgentSessionDetail`.

In `web/src/components/SessionTranscript.tsx`, change the message `<li>` to carry the
uuid:

```tsx
                <li class={`msg msg-${msg.role}`} data-msg-uuid={msg.uuid ?? undefined}>
```

- [ ] **Step 8: Run the web tests to verify they pass**

Run: `cd web && bun run test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/sessions/vault.ts server/tests/vault-summaries.test.ts web/src/api.ts web/src/components/SessionTranscript.tsx web/tests/SessionTranscript.test.tsx
git commit -m "feat(sessions): carry message uuids through to the transcript DOM"
```

---

## Task 10: The `SessionSummary` component

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/SessionSummary.tsx`
- Test: `web/tests/SessionSummary.test.tsx`

- [ ] **Step 1: Add the API client**

In `web/src/api.ts`, append:

```ts
export type SessionMoment = { uuid: string; label: string };

export type SessionSummaryStatus = {
  status: "ready" | "pending" | "error" | "absent" | "skipped";
  summary?: string;
  moments?: SessionMoment[];
  model?: string | null;
  generatedAt?: number;
  stale?: boolean;
  error?: string | null;
};

export async function getSessionSummary(sessionId: string): Promise<SessionSummaryStatus> {
  return unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/summary`),
    "session summary",
  );
}

export async function requestSessionSummary(
  sessionId: string,
  force = false,
): Promise<SessionSummaryStatus> {
  return unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }),
    "session summary",
  );
}
```

- [ ] **Step 2: Write the failing tests**

Create `web/tests/SessionSummary.test.tsx`:

```tsx
import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import SessionSummary from "../src/components/SessionSummary";

vi.mock("../src/api", () => ({
  getSessionSummary: vi.fn(),
  requestSessionSummary: vi.fn(),
}));

const api = await import("../src/api");
const getMock = () => api.getSessionSummary as ReturnType<typeof vi.fn>;
const postMock = () => api.requestSessionSummary as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getMock().mockReset();
  postMock().mockReset();
});

test("renders a ready summary and its moments", async () => {
  getMock().mockResolvedValue({
    status: "ready", summary: "It refactored the parser.",
    moments: [{ uuid: "u1", label: "found the bug" }], stale: false,
  });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("It refactored the parser."));
  expect(container.textContent).toContain("found the bug");
});

test("clicking a moment calls onJump with its uuid", async () => {
  getMock().mockResolvedValue({
    status: "ready", summary: "s", moments: [{ uuid: "u7", label: "the moment" }], stale: false,
  });
  const jumps: string[] = [];
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={(u) => jumps.push(u)} />
  ));
  await waitFor(() => expect(container.textContent).toContain("the moment"));
  fireEvent.click(getByText("the moment"));
  expect(jumps).toEqual(["u7"]);
});

test("absent + not live → requests generation and shows the pending state", async () => {
  getMock().mockResolvedValue({ status: "absent" });
  postMock().mockResolvedValue({ status: "pending" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title="Fix the parser" isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", false));
  expect(container.textContent).toContain("Fix the parser");
  expect(container.textContent?.toLowerCase()).toContain("summarizing");
});

test("a live session is not summarized automatically", async () => {
  getMock().mockResolvedValue({ status: "absent" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={true} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  expect(postMock()).not.toHaveBeenCalled();
  expect(container.querySelector("button")).not.toBeNull();
});

test("error shows the message and a retry that forces regeneration", async () => {
  getMock().mockResolvedValue({ status: "error", error: "claude exited 1" });
  postMock().mockResolvedValue({ status: "pending" });
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("claude exited 1"));
  fireEvent.click(getByText("Retry"));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", true));
});

test("stale shows a regenerate control alongside the old summary", async () => {
  getMock().mockResolvedValue({ status: "ready", summary: "old news", moments: [], stale: true });
  postMock().mockResolvedValue({ status: "pending" });
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("old news"));
  fireEvent.click(getByText("Regenerate"));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", true));
});

test("skipped renders nothing", async () => {
  getMock().mockResolvedValue({ status: "skipped" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  expect(container.querySelector(".session-summary")).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && bun run test -- SessionSummary`
Expected: FAIL — cannot resolve `../src/components/SessionSummary`.

- [ ] **Step 4: Implement the component**

Create `web/src/components/SessionSummary.tsx`:

```tsx
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { getSessionSummary, requestSessionSummary, type SessionSummaryStatus } from "../api";

const POLL_MS = 2000;
const MAX_POLLS = 60; // ~2 minutes

export default function SessionSummary(props: {
  sessionId: string;
  title: string | null;
  /** Live, working sessions are a moving target — summarize them only on request. */
  isLive: boolean;
  onJump: (uuid: string) => void;
}) {
  const [state, setState] = createSignal<SessionSummaryStatus>({ status: "pending" });
  const [busy, setBusy] = createSignal(false);

  async function generate(force: boolean): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      setState(await requestSessionSummary(props.sessionId, force));
    } catch (err) {
      setState({ status: "error", error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  createEffect(() => {
    const sessionId = props.sessionId;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      let next: SessionSummaryStatus;
      try {
        next = await getSessionSummary(sessionId);
      } catch (err) {
        if (!cancelled) setState({ status: "error", error: (err as Error).message });
        return;
      }
      if (cancelled) return;
      setState(next);

      if (next.status === "absent" && !props.isLive && polls === 0) {
        void generate(false);
        polls++;
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      if (next.status === "pending" && polls < MAX_POLLS) {
        polls++;
        timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    onCleanup(() => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    });
  });

  const s = () => state();

  return (
    <Show when={s().status !== "skipped"}>
      <section class="session-summary">
        <Show when={props.title}>
          <h3 class="session-summary-title">{props.title}</h3>
        </Show>

        <Show when={s().status === "pending" || (s().status === "absent" && !props.isLive)}>
          <div class="session-summary-pending muted">summarizing…</div>
        </Show>

        <Show when={s().status === "absent" && props.isLive}>
          <button class="session-summary-action" onclick={() => void generate(false)}>
            Summarize
          </button>
        </Show>

        <Show when={s().status === "error"}>
          <div class="session-summary-error">
            <span class="muted">summary failed: {s().error}</span>
            <button class="session-summary-action" onclick={() => void generate(true)}>Retry</button>
          </div>
        </Show>

        <Show when={s().status === "ready"}>
          <Show when={s().stale}>
            <div class="session-summary-stale">
              <span class="muted">this session continued after the summary was made</span>
              <button class="session-summary-action" onclick={() => void generate(true)}>
                Regenerate
              </button>
            </div>
          </Show>
          <p class="session-summary-text">{s().summary}</p>
          <Show when={(s().moments ?? []).length > 0}>
            <ul class="session-summary-moments">
              <For each={s().moments}>
                {(m) => (
                  <li>
                    <button class="session-moment" onclick={() => props.onJump(m.uuid)}>
                      {m.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>
    </Show>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun run test -- SessionSummary`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/components/SessionSummary.tsx web/tests/SessionSummary.test.tsx
git commit -m "feat(web): add the session summary component"
```

---

## Task 11: Mount the summary and wire up jumping

**Files:**
- Modify: `web/src/components/SessionTranscript.tsx`
- Modify: `web/src/styles.css`
- Test: `web/tests/SessionTranscript.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `web/tests/SessionTranscript.test.tsx`. Note this file's existing
`vi.mock("../src/api", …)` factory only exports `getAgentSessionDetail`; extend that
factory to also export `getSessionSummary` and `requestSessionSummary` as
`vi.fn(async () => ({ status: "skipped" }))`, otherwise every existing test in the
file will fail on the new import.

```tsx
test("jumping to a moment scrolls that message into view and flashes it", async () => {
  const api = await import("../src/api");
  (api.getSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "ready", summary: "a summary", moments: [{ uuid: "u-anchor", label: "the moment" }],
    stale: false,
  });
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s5", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u-anchor", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"anchor me"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });

  const { container, getByText } = render(() => (
    <SessionTranscript sessionId="s5" onResume={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("the moment"));

  const target = container.querySelector('[data-msg-uuid="u-anchor"]') as HTMLElement;
  const scrolled: unknown[] = [];
  target.scrollIntoView = ((opts: unknown) => scrolled.push(opts)) as never;

  fireEvent.click(getByText("the moment"));
  expect(scrolled).toHaveLength(1);
  expect(target.classList.contains("msg-flash")).toBe(true);
});
```

Add `fireEvent` to the existing `@solidjs/testing-library` import in that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && bun run test -- SessionTranscript`
Expected: FAIL — "the moment" never renders (no summary is mounted).

- [ ] **Step 3: Mount the summary and implement jumping**

In `web/src/components/SessionTranscript.tsx`:

Add the import:

```tsx
import SessionSummary from "./SessionSummary";
```

Add the jump handler inside the component, above the `return`:

```tsx
  let bodyRef: HTMLOListElement | undefined;

  // The digest only ever includes messages that render, so a miss here means the
  // message was filtered out after the summary was made — do nothing rather than
  // scroll somewhere arbitrary.
  function jumpTo(uuid: string): void {
    // uuids are hex + dashes, so a plain attribute selector is safe here — and
    // CSS.escape is not guaranteed present under jsdom in the test environment.
    if (!/^[A-Za-z0-9-]+$/.test(uuid)) return;
    const el = bodyRef?.querySelector<HTMLElement>(`[data-msg-uuid="${uuid}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-flash");
    setTimeout(() => el.classList.remove("msg-flash"), 1200);
  }
```

Insert the summary between the `</header>` and the `<ol …>`:

```tsx
          <SessionSummary
            sessionId={props.sessionId}
            title={d().session.title ?? null}
            isLive={false}
            onJump={jumpTo}
          />
```

and attach the ref to the list:

```tsx
          <ol class="session-transcript-body" ref={bodyRef}>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && bun run test -- SessionTranscript`
Expected: PASS.

- [ ] **Step 5: Add the styles**

Append to `web/src/styles.css`:

```css
.session-summary {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border, #2a2a2a);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.session-summary-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}
.session-summary-text {
  margin: 0;
  line-height: 1.5;
}
.session-summary-moments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.session-moment {
  background: var(--chip-bg, #23272e);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.session-moment:hover {
  border-color: var(--accent, #6ab0f3);
}
.session-summary-error,
.session-summary-stale {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.session-summary-pending {
  font-size: 0.85rem;
  opacity: 0.7;
}
.msg-flash {
  animation: msg-flash 1.2s ease-out;
}
@keyframes msg-flash {
  0% { background: var(--accent-dim, rgba(106, 176, 243, 0.25)); }
  100% { background: transparent; }
}
```

- [ ] **Step 6: Run both suites**

Run: `cd server && bun test`
Expected: PASS.

Run: `cd web && bun run test`
Expected: PASS.

- [ ] **Step 7: Verify in the real app**

Run `bun run dev:server` and `bun run dev:web`, open http://localhost:5173, open a
project, go to the **sessions** tab in the info pane, and click a closed session.

Expected: the transcript opens with "summarizing…" at the top, and within ~20s a
paragraph plus moment chips appear. Clicking a chip scrolls the transcript to that
message and flashes it. Reopening the session shows the summary instantly.

Then confirm the guards held — the summarizer run must not appear anywhere:

```bash
curl -s localhost:52810/api/sessions?limit=200 | grep -c summarizer
```

Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/SessionTranscript.tsx web/src/styles.css web/tests/SessionTranscript.test.tsx
git commit -m "feat(web): show session summaries with jump-to-moment links"
```

---

## Self-review notes

**Spec coverage:** subprocess shape and flags (Task 7), Haiku model (Task 7), three
pollution guards (Tasks 6–8), digest rendering with per-message and total budgets
(Task 4), fence stripping and uuid validation (Task 5), job dedupe/concurrency/
timeout/shutdown (Task 7), storage with staleness fields (Task 3), `ai-title`
capture and dead-branch removal (Task 1–2), API routes registered before the
catch-all (Task 8), `uuid` plumbing (Task 9), component states (Task 10), anchor
scroll and flash (Task 11).

**Known deferral:** `isLive` is passed as `false` from `SessionTranscript` because
the component has no live-session signal today. The manual-button path in
`SessionSummary` is implemented and tested, so wiring a real value later is a
one-line change. Sessions opened from the info pane's sessions list are historical
by definition, which is the case this feature targets.
