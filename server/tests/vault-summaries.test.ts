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

describe("summary storage", () => {
  test("upsertSummary then getSummary round-trips", () => {
    seedSession("s1");
    vault.upsertSummary({
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

  test("upsertSummary replaces an existing row", () => {
    seedSession("s1");
    const base = {
      session_id: "s1", moments: "[]", model: null,
      generated_at: 1, source_last_activity: 1, source_message_count: 1,
    };
    vault.upsertSummary({ ...base, summary: null, status: "error", error: "boom" });
    vault.upsertSummary({ ...base, summary: "ok now", status: "ok", error: null });
    expect(vault.getSummary("s1")!.status).toBe("ok");
    expect(vault.getSummary("s1")!.error).toBeNull();
  });

  test("deleting the session cascades the summary away", () => {
    seedSession("s1");
    vault.upsertSummary({
      session_id: "s1", summary: "x", moments: "[]", model: null,
      status: "ok", error: null, generated_at: 1,
      source_last_activity: 1, source_message_count: 1,
    });
    db.query("DELETE FROM agent_sessions WHERE session_id = ?").run("s1");
    expect(vault.getSummary("s1")).toBeUndefined();
  });

  // Deliberate: with no matching agent_sessions row, the FOREIGN KEY constraint
  // must reject the insert loudly rather than silently leaving an orphaned
  // summary row. This pins that behavior so a future change to FK pragma
  // handling or table creation order can't quietly turn it into a silent orphan.
  test("upsertSummary throws when the session does not exist", () => {
    expect(() =>
      vault.upsertSummary({
        session_id: "missing", summary: "x", moments: "[]", model: null,
        status: "ok", error: null, generated_at: 1,
        source_last_activity: 1, source_message_count: 1,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
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
