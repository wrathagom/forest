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
