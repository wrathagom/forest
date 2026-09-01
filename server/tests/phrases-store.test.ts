import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { PhraseStore } from "../src/phrases/store";

function ngram(db: ReturnType<typeof openDb>, phrase: string, month: string, count: number, n = 3) {
  db.query("INSERT INTO agent_ngrams (agent, n, phrase, month, count) VALUES ('claude', ?, ?, ?, ?)").run(n, phrase, month, count);
}

describe("PhraseStore.leaderboard", () => {
  test("sorts by total count desc and sums across the range", () => {
    const db = openDb(":memory:");
    ngram(db, "take a look", "2026-05", 10);
    ngram(db, "take a look", "2026-06", 5);
    ngram(db, "the crux of", "2026-06", 8);
    const store = new PhraseStore(db);
    const res = store.leaderboard({ agent: "claude", n: 3, sort: "count", limit: 10, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.phrases[0]).toMatchObject({ phrase: "take a look", count: 15 });
    expect(res.phrases[0]!.monthly).toEqual([{ month: "2026-05", count: 10 }, { month: "2026-06", count: 5 }]);
    expect(res.phrases[1]).toMatchObject({ phrase: "the crux of", count: 8 });
  });

  test("trending sort surfaces a newly emerged phrase over a steady one", () => {
    const db = openDb(":memory:");
    // steady: same each month; emergent: only the latest month, high.
    ngram(db, "you re absolutely right", "2026-04", 20);
    ngram(db, "you re absolutely right", "2026-05", 20);
    ngram(db, "you re absolutely right", "2026-06", 20);
    ngram(db, "in a way that matters", "2026-06", 15, 3);
    const store = new PhraseStore(db);
    const res = store.leaderboard({ agent: "claude", n: 3, sort: "trending", limit: 10, offset: 0 });
    expect(res.phrases[0]!.phrase).toBe("in a way that matters");
  });

  test("respects month range and pagination", () => {
    const db = openDb(":memory:");
    ngram(db, "alpha beta gamma", "2026-01", 5);
    ngram(db, "alpha beta gamma", "2026-06", 5);
    const store = new PhraseStore(db);
    const res = store.leaderboard({ agent: "claude", n: 3, from: "2026-05", to: "2026-12", sort: "count", limit: 10, offset: 0 });
    expect(res.phrases[0]!.count).toBe(5); // only the June bucket is in range
  });
});

describe("PhraseStore.occurrences", () => {
  test("returns assistant-only hits with snippets", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/tmp", project_id: null, last_activity: 1, source: "scan" });
    v.upsertMessages(
      [{ session_id: "s1", uuid: "m1", role: "assistant", content: "{}", timestamp: 1000, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
      [{ uuid: "m1", text: "we did it in a way that matters to users" }],
    );
    const store = new PhraseStore(db);
    const hits = store.occurrences({ phrase: "in a way that matters", agent: "claude", limit: 10, offset: 0 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.session_id).toBe("s1");
    expect(hits[0]!.snippet).toContain("<mark>");
  });
});
