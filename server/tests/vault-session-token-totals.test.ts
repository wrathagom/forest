import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";

function msg(
  session_id: string,
  uuid: string,
  timestamp: number,
  tok: Partial<{ input: number; output: number; cacheCreate: number; cacheRead: number }> = {},
) {
  return {
    session_id,
    uuid,
    role: "assistant",
    content: "{}",
    timestamp,
    model: null,
    input_tokens: tok.input ?? null,
    cache_create_tokens: tok.cacheCreate ?? null,
    cache_read_tokens: tok.cacheRead ?? null,
    output_tokens: tok.output ?? null,
    stop_reason: null,
  };
}

// Read the denormalized totals straight off the session row — these columns are
// what lets listAll / tokensByProject avoid re-summing the whole messages table.
function storedTotals(db: ReturnType<typeof openDb>, sessionId: string) {
  return db
    .query<{ input_tokens: number; output_tokens: number; cache_tokens: number }, [string]>(
      "SELECT input_tokens, output_tokens, cache_tokens FROM agent_sessions WHERE session_id = ?",
    )
    .get(sessionId);
}

describe("agent_sessions denormalized token totals", () => {
  test("upsertMessages stores per-session token totals on the session row", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/a", last_activity: 1, source: "scan" });
    v.upsertMessages([msg("s1", "m1", 1, { input: 100, output: 50, cacheCreate: 5, cacheRead: 200 })], []);
    expect(storedTotals(db, "s1")).toEqual({ input_tokens: 100, output_tokens: 50, cache_tokens: 205 });
  });

  test("a session with no token-bearing messages keeps zero totals", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s0", agent: "claude", cwd: "/a", last_activity: 1, source: "scan" });
    v.upsertMessages([msg("s0", "m0", 1, {})], []);
    expect(storedTotals(db, "s0")).toEqual({ input_tokens: 0, output_tokens: 0, cache_tokens: 0 });
  });

  test("multiple ingest batches accumulate the totals", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s2", agent: "claude", cwd: "/a", last_activity: 1, source: "scan" });
    v.upsertMessages([msg("s2", "a", 1, { input: 10, output: 1 })], []);
    v.upsertMessages([msg("s2", "b", 2, { input: 5, output: 2, cacheRead: 3 })], []);
    expect(storedTotals(db, "s2")).toEqual({ input_tokens: 15, output_tokens: 3, cache_tokens: 3 });
  });

  test("re-ingesting duplicate uuids does not double-count", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s3", agent: "claude", cwd: "/a", last_activity: 1, source: "scan" });
    const batch = [msg("s3", "dup", 1, { input: 100, output: 20 })];
    v.upsertMessages(batch, []);
    v.upsertMessages(batch, []); // same uuid — ON CONFLICT DO NOTHING
    expect(storedTotals(db, "s3")).toEqual({ input_tokens: 100, output_tokens: 20, cache_tokens: 0 });
  });
});
