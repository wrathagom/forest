import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import {
  getCaffeinateState,
  setCaffeinateState,
  clearCaffeinateState,
} from "../src/store/config";

describe("caffeinate state persistence", () => {
  test("round-trips a timed run", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 1_000, durationSec: 3600 });
    expect(getCaffeinateState(db)).toEqual({ startedAt: 1_000, durationSec: 3600 });
  });

  test("round-trips an indefinite run", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 2_000, durationSec: null });
    expect(getCaffeinateState(db)).toEqual({ startedAt: 2_000, durationSec: null });
  });

  test("clear removes the row", () => {
    const db = openDb(":memory:");
    setCaffeinateState(db, { startedAt: 3_000, durationSec: 7200 });
    clearCaffeinateState(db);
    expect(getCaffeinateState(db)).toBeNull();
  });

  test("returns null when nothing is stored", () => {
    const db = openDb(":memory:");
    expect(getCaffeinateState(db)).toBeNull();
  });

  test("returns null and self-heals on corrupt JSON", () => {
    const db = openDb(":memory:");
    db.query("INSERT INTO config (key, value) VALUES (?, ?)").run("caffeinate.state", "not-json");
    expect(getCaffeinateState(db)).toBeNull();
  });
});
