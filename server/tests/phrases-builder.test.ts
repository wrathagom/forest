import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { PhraseIndexBuilder } from "../src/phrases/builder";

function assistantLine(text: string): string {
  return JSON.stringify({
    type: "assistant", sessionId: "s1", cwd: "/tmp", timestamp: "2026-06-01T00:00:00Z",
    uuid: "x", message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function seed(db: ReturnType<typeof openDb>): Vault {
  const now = Date.now();
  db.query("INSERT INTO projects (id, path, name, pinned, hidden, created_at, updated_at) VALUES ('p','/tmp','P',0,0,?,?)").run(now, now);
  const v = new Vault(db);
  v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/tmp", project_id: "p", last_activity: 1, source: "scan" });
  const juneTs = Date.parse("2026-06-15T00:00:00Z");
  // "in a way that matters" appears 3 times across two June messages.
  v.upsertMessages(
    [{ session_id: "s1", uuid: "m1", role: "assistant", content: assistantLine("in a way that matters. in a way that matters."), timestamp: juneTs, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
    [{ uuid: "m1", text: "in a way that matters. in a way that matters." }],
  );
  v.upsertMessages(
    [{ session_id: "s1", uuid: "m2", role: "assistant", content: assistantLine("in a way that matters."), timestamp: juneTs, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
    [{ uuid: "m2", text: "in a way that matters." }],
  );
  return v;
}

describe("PhraseIndexBuilder.rebuild", () => {
  test("counts phrases into agent_ngrams and honours the min-total threshold", async () => {
    const db = openDb(":memory:");
    seed(db);
    const builder = new PhraseIndexBuilder(db, { minTotal: 3, batchSize: 10 });
    await builder.rebuild();

    const row = db.query<{ count: number }, [string, number]>(
      "SELECT SUM(count) AS count FROM agent_ngrams WHERE phrase = ? AND n = ?",
    ).get("in a way that matters", 5);
    expect(row?.count).toBe(3);

    // A rare phrase below the threshold is pruned.
    const rare = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agent_ngrams WHERE phrase = 'way that matters here'").get();
    expect(rare?.count).toBe(0);

    // All rows are bucketed to June 2026.
    const months = db.query<{ month: string }, []>("SELECT DISTINCT month FROM agent_ngrams").all().map((r) => r.month);
    expect(months).toEqual(["2026-06"]);
  });

  test("status reports lastBuiltAt and clears staleness after a build", async () => {
    const db = openDb(":memory:");
    seed(db);
    const builder = new PhraseIndexBuilder(db, { minTotal: 1, batchSize: 10 });
    expect(builder.isStale()).toBe(true); // never built
    await builder.rebuild();
    const status = builder.status();
    expect(status.lastBuiltAt).not.toBeNull();
    expect(status.staleNewMsgs).toBe(0);
    expect(builder.isStale()).toBe(false);
  });
});
