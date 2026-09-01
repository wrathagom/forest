import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";

describe("agent_ngrams schema", () => {
  test("table exists with the expected columns", () => {
    const db = openDb(":memory:");
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(agent_ngrams)").all().map((c) => c.name);
    expect(cols.sort()).toEqual(["agent", "count", "month", "n", "phrase"]);
  });
});
