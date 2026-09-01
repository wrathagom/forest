import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault, __setExistsForTest } from "../src/sessions/vault";

describe("refreshCwdExists caching", () => {
  test("stats a given cwd at most once within the TTL", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/tmp/x", last_activity: 1, source: "scan" });
    v.upsertSession({ session_id: "s2", agent: "claude", cwd: "/tmp/x", last_activity: 2, source: "scan" });

    let calls = 0;
    __setExistsForTest((p) => { calls++; return true; });

    v.getSession("s1");
    v.getSession("s2");
    expect(calls).toBe(1); // second lookup served from cache
  });
});
