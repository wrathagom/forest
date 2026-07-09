import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";

const baseSession = {
  session_id: "sid-1",
  agent: "claude" as const,
  cwd: "/tmp/proj",
  last_activity: 1_000,
  first_user_msg: "hello",
};

describe("Vault.upsertSession", () => {
  test("inserts a new row with imported_at and source", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, source: "scan" });
    const row = db
      .query<{ session_id: string; source: string; imported_at: number }, [string]>(
        "SELECT session_id, source, imported_at FROM agent_sessions WHERE session_id = ?",
      )
      .get("sid-1");
    expect(row?.source).toBe("scan");
    expect(row?.imported_at).toBeGreaterThan(0);
  });

  test("updates last_activity when newer record arrives, preserves first_user_msg", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, source: "scan" });
    v.upsertSession({
      ...baseSession,
      last_activity: 2_000,
      first_user_msg: undefined,
      source: "hook:precompact",
    });
    const row = db
      .query<
        { last_activity: number; first_user_msg: string | null; source: string },
        [string]
      >(
        "SELECT last_activity, first_user_msg, source FROM agent_sessions WHERE session_id = ?",
      )
      .get("sid-1");
    expect(row?.last_activity).toBe(2_000);
    expect(row?.first_user_msg).toBe("hello"); // preserved
    expect(row?.source).toBe("hook:precompact");
  });

  test("does not regress last_activity if older record arrives second", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, last_activity: 5_000, source: "hook:sessionend" });
    v.upsertSession({ ...baseSession, last_activity: 1_000, source: "scan" });
    const row = db
      .query<{ last_activity: number }, [string]>(
        "SELECT last_activity FROM agent_sessions WHERE session_id = ?",
      )
      .get("sid-1");
    expect(row?.last_activity).toBe(5_000);
  });
});

describe("Vault.upsertMessages", () => {
  test("inserts messages and FTS rows, idempotent on uuid", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, source: "scan" });
    v.upsertMessages(
      [
        {
          session_id: "sid-1",
          uuid: "u1",
          role: "user",
          content: '{"type":"user"}',
          timestamp: 1_000,
          model: null,
          input_tokens: null,
          cache_create_tokens: null,
          cache_read_tokens: null,
          output_tokens: null,
          stop_reason: null,
        },
      ],
      [{ uuid: "u1", text: "hello world" }],
    );
    // second call with the same uuid must not duplicate
    v.upsertMessages(
      [
        {
          session_id: "sid-1",
          uuid: "u1",
          role: "user",
          content: '{"type":"user"}',
          timestamp: 1_000,
          model: null,
          input_tokens: null,
          cache_create_tokens: null,
          cache_read_tokens: null,
          output_tokens: null,
          stop_reason: null,
        },
      ],
      [{ uuid: "u1", text: "hello world" }],
    );
    const count = db
      .query<{ n: number }, []>("SELECT count(*) AS n FROM agent_messages")
      .get();
    expect(count?.n).toBe(1);
    const fts = db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM agent_messages_fts WHERE text MATCH ?",
      )
      .get("hello");
    expect(fts?.n).toBe(1);
  });
});

describe("Vault.upsertToolCalls + applyToolResults", () => {
  test("tool call + result joins by tool_use_id and computes duration_ms", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, source: "scan" });
    v.upsertToolCalls([
      {
        session_id: "sid-1",
        tool_use_id: "toolu_01",
        tool_name: "Bash",
        tool_input: '{"command":"ls"}',
        started_at: 1_000,
        finished_at: null,
        duration_ms: null,
        result_status: null,
        result_size: null,
        message_uuid: null,
      },
    ]);
    v.applyToolResults([
      {
        session_id: "sid-1",
        tool_use_id: "toolu_01",
        finished_at: 1_500,
        result_status: "ok",
        result_size: 42,
      },
    ]);
    const row = db
      .query<
        { duration_ms: number; result_status: string; result_size: number },
        [string]
      >(
        "SELECT duration_ms, result_status, result_size FROM agent_tool_calls WHERE tool_use_id = ?",
      )
      .get("toolu_01");
    expect(row?.duration_ms).toBe(500);
    expect(row?.result_status).toBe("ok");
    expect(row?.result_size).toBe(42);
  });
});

describe("Vault.appendEvents", () => {
  test("inserts session events", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ ...baseSession, source: "scan" });
    v.appendEvents([
      { session_id: "sid-1", kind: "compacted", timestamp: 2_000, payload: null },
    ]);
    const ev = db
      .query<{ kind: string }, [string]>(
        "SELECT kind FROM agent_session_events WHERE session_id = ?",
      )
      .get("sid-1");
    expect(ev?.kind).toBe("compacted");
  });
});

describe("Vault read APIs", () => {
  function seed(db: ReturnType<typeof openDb>) {
    // Insert the project row required by the FK constraint on agent_sessions.project_id
    db.query(
      "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("p1", "/tmp/p1", "Project One", Date.now(), Date.now());

    const v = new Vault(db);
    v.upsertSession({
      ...baseSession,
      session_id: "sid-A",
      project_id: "p1",
      worktree_label: "main",
      last_activity: 5,
      first_user_msg: "alpha",
      source: "scan",
    });
    v.upsertSession({
      ...baseSession,
      session_id: "sid-B",
      project_id: "p1",
      worktree_label: "wt",
      last_activity: 10,
      first_user_msg: "beta",
      source: "scan",
    });
    v.upsertMessages(
      [{ session_id: "sid-A", uuid: "ua", role: "user", content: "{}", timestamp: 5, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
      [{ uuid: "ua", text: "alpha unique" }],
    );
    v.upsertMessages(
      [{ session_id: "sid-B", uuid: "ub", role: "user", content: "{}", timestamp: 10, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
      [{ uuid: "ub", text: "beta unique" }],
    );
    return v;
  }

  test("listByProject returns rows sorted by last_activity DESC", () => {
    const db = openDb(":memory:");
    seed(db);
    const v = new Vault(db);
    const rows = v.listByProject("p1");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.session_id).toBe("sid-B");
    expect(rows[1]!.session_id).toBe("sid-A");
  });

  test("getSession with messages returns full transcript", () => {
    const db = openDb(":memory:");
    seed(db);
    const v = new Vault(db);
    const detail = v.getSessionDetail("sid-A");
    expect(detail?.session.session_id).toBe("sid-A");
    expect(detail?.messages).toHaveLength(1);
  });

  test("searchByProject matches FTS scoped to the project", () => {
    const db = openDb(":memory:");
    seed(db);
    const v = new Vault(db);
    const hits = v.searchByProject("p1", "alpha");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session_id).toBe("sid-A");
  });

  test("mtimeFor returns last_activity for a session, undefined if missing", () => {
    const db = openDb(":memory:");
    seed(db);
    const v = new Vault(db);
    expect(v.mtimeFor("sid-A")).toBe(5);
    expect(v.mtimeFor("nope")).toBeUndefined();
  });

  test("listByProject backfills first_user_msg from stored messages when null", () => {
    const db = openDb(":memory:");
    db.query(
      "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("p2", "/tmp/p2", "Project Two", Date.now(), Date.now());
    const v = new Vault(db);
    v.upsertSession({
      session_id: "sid-null",
      agent: "claude",
      cwd: "/tmp/p2",
      project_id: "p2",
      last_activity: 100,
      first_user_msg: undefined,
      source: "scan",
    });
    const userLine = (text: string, ts: number) => JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
    });
    v.upsertMessages(
      [
        // earliest user line is a real prompt — should be picked up
        { session_id: "sid-null", uuid: "u1", role: "user",
          content: userLine("real first prompt", 50),
          timestamp: 50, model: null, input_tokens: null, cache_create_tokens: null,
          cache_read_tokens: null, output_tokens: null, stop_reason: null },
        { session_id: "sid-null", uuid: "u2", role: "user",
          content: userLine("second prompt", 60),
          timestamp: 60, model: null, input_tokens: null, cache_create_tokens: null,
          cache_read_tokens: null, output_tokens: null, stop_reason: null },
      ],
      [{ uuid: "u1", text: "real first prompt" }, { uuid: "u2", text: "second prompt" }],
    );
    const rows = v.listByProject("p2");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.first_user_msg).toBe("real first prompt");
  });

  test("listByProject leaves non-null first_user_msg untouched", () => {
    const db = openDb(":memory:");
    seed(db);
    const v = new Vault(db);
    const rows = v.listByProject("p1");
    expect(rows.find((r) => r.session_id === "sid-A")?.first_user_msg).toBe("alpha");
    expect(rows.find((r) => r.session_id === "sid-B")?.first_user_msg).toBe("beta");
  });
});

test("getSession returns a single session row or undefined", () => {
  const db = openDb(":memory:");
  const v = new Vault(db);
  v.upsertSession({ session_id: "g1", agent: "claude", cwd: "/p", last_activity: 5, project_id: null, source: "scan" });
  expect(v.getSession("g1")?.session_id).toBe("g1");
  expect(v.getSession("nope")).toBeUndefined();
});

describe("Vault.lastAssistantText", () => {
  test("returns null when there are no assistant messages", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "la1", agent: "claude", cwd: "/p", last_activity: 1, source: "scan" });
    expect(v.lastAssistantText("la1")).toBeNull();
  });

  test("returns the most recent non-empty assistant message, truncated at 140 chars", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "la2", agent: "claude", cwd: "/p", last_activity: 1, source: "scan" });
    v.upsertMessages(
      [
        { session_id: "la2", uuid: "u1", role: "assistant", content: "first reply", timestamp: 1_000, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null },
        { session_id: "la2", uuid: "u2", role: "assistant", content: "second reply", timestamp: 2_000, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null },
      ],
      [],
    );
    expect(v.lastAssistantText("la2")).toBe("second reply");
  });

  test("truncates long messages to 139 chars + ellipsis", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "la3", agent: "claude", cwd: "/p", last_activity: 1, source: "scan" });
    const long = "x".repeat(200);
    v.upsertMessages(
      [{ session_id: "la3", uuid: "u3", role: "assistant", content: long, timestamp: 1_000, model: null, input_tokens: null, cache_create_tokens: null, cache_read_tokens: null, output_tokens: null, stop_reason: null }],
      [],
    );
    const result = v.lastAssistantText("la3");
    expect(result).toHaveLength(140);
    expect(result!.endsWith("…")).toBe(true);
  });
});

describe("Vault.recentSessions", () => {
  test("returns rows newest-first with project_name joined", () => {
    const db = openDb(":memory:");
    db.query("INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("proj1", "/tmp/proj1", "My Project", Date.now(), Date.now());
    const v = new Vault(db);
    v.upsertSession({ session_id: "rs1", agent: "claude", cwd: "/p", last_activity: 1_000, project_id: "proj1", source: "scan" });
    v.upsertSession({ session_id: "rs2", agent: "claude", cwd: "/p", last_activity: 2_000, project_id: "proj1", source: "scan" });
    v.upsertSession({ session_id: "rs3", agent: "claude", cwd: "/p", last_activity: 3_000, project_id: null, source: "scan" });
    const rows = v.recentSessions(10);
    expect(rows[0]!.session_id).toBe("rs3");
    expect(rows[1]!.session_id).toBe("rs2");
    expect(rows[2]!.session_id).toBe("rs1");
    expect(rows[1]!.project_name).toBe("My Project");
    expect(rows[0]!.project_name).toBeNull();
  });

  test("excludes sessions with a non-null parent_session_id", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "root-sid", agent: "claude", cwd: "/p", last_activity: 1_000, source: "scan" });
    v.upsertSession({ session_id: "child-sid", agent: "claude", cwd: "/p", last_activity: 2_000, source: "scan", parent_session_id: "some-parent" });
    const rows = v.recentSessions(10);
    const ids = rows.map((r) => r.session_id);
    expect(ids).toContain("root-sid");
    expect(ids).not.toContain("child-sid");
  });
});

describe("vault — launched_via / permission_mode", () => {
  test("upsertSession persists launched_via + permission_mode; getSession returns them", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "m1", agent: "claude", cwd: "/p", last_activity: 5,
      project_id: null, source: "mobile", launched_via: "mobile", permission_mode: "acceptEdits",
    });
    const row = v.getSession("m1")!;
    expect(row.launched_via).toBe("mobile");
    expect(row.permission_mode).toBe("acceptEdits");
  });

  test("the two columns exist and default to NULL for plain sessions", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/p", last_activity: 1, source: "scan" });
    const row = v.getSession("s1")!;
    expect(row.launched_via).toBeNull();
    expect(row.permission_mode).toBeNull();
  });

  test("ON CONFLICT COALESCE: second upsert WITH values sets them when first had none", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    // First upsert: no launched_via / permission_mode
    v.upsertSession({ session_id: "c1", agent: "claude", cwd: "/p", last_activity: 1, source: "scan" });
    // Second upsert: same session_id, now WITH the values
    v.upsertSession({
      session_id: "c1", agent: "claude", cwd: "/p", last_activity: 2,
      source: "mobile", launched_via: "mobile", permission_mode: "acceptEdits",
    });
    const row = v.getSession("c1")!;
    expect(row.launched_via).toBe("mobile");
    expect(row.permission_mode).toBe("acceptEdits");
  });

  test("ON CONFLICT COALESCE: second upsert WITHOUT values does not clobber existing ones", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    // First upsert: set launched_via and permission_mode
    v.upsertSession({
      session_id: "c2", agent: "claude", cwd: "/p", last_activity: 1,
      source: "mobile", launched_via: "mobile", permission_mode: "acceptEdits",
    });
    // Second upsert: same session_id, values omitted — only last_activity changes
    v.upsertSession({ session_id: "c2", agent: "claude", cwd: "/p", last_activity: 2, source: "scan" });
    const row = v.getSession("c2")!;
    // COALESCE keeps the originally-set values, not NULL
    expect(row.launched_via).toBe("mobile");
    expect(row.permission_mode).toBe("acceptEdits");
  });
});

describe("Vault profile field", () => {
  test("upsertSession stores profile and getSession/getSessionDetail return it", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "s-prof", agent: "claude", cwd: "/x", last_activity: 1000,
      source: "scan", profile: "work",
    });
    expect(v.getSession("s-prof")?.profile).toBe("work");
    expect(v.getSessionDetail("s-prof")?.session.profile).toBe("work");
  });

  test("profile is null when not supplied", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "s-np", agent: "claude", cwd: "/x", last_activity: 1, source: "scan" });
    expect(v.getSession("s-np")?.profile).toBeNull();
  });
});

// A worktree's transcript lives under the Claude config dir, not inside the
// worktree, so deleting the worktree never bumps the transcript's mtime and the
// scanner's `known >= mtime` guard skips re-ingesting it. A `cwd_exists` cached
// at ingest time therefore stays 1 forever, and the UI keeps offering a plain
// "Resume" that launches into a directory that is gone.
describe("Vault re-derives cwd_exists on read", () => {
  const gone = "/tmp/forest-test-gone-worktree";
  const setup = () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    db.query(
      "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('p1','p','/tmp/p',1,1)",
    ).run();
    v.upsertSession({
      session_id: "sid-gone",
      agent: "claude",
      cwd: gone,
      last_activity: 1_000,
      project_id: "p1",
      cwd_exists: true, // recorded while the worktree still existed
      source: "scan",
    });
    return v;
  };

  test("getSession reports a deleted cwd as gone", () => {
    expect(setup().getSession("sid-gone")?.cwd_exists).toBe(0);
  });

  test("getSessionDetail reports a deleted cwd as gone", () => {
    expect(setup().getSessionDetail("sid-gone")?.session.cwd_exists).toBe(0);
  });

  test("listByProject reports a deleted cwd as gone", () => {
    expect(setup().listByProject("p1")[0]?.cwd_exists).toBe(0);
  });

  test("listAll reports a deleted cwd as gone", () => {
    expect(setup().listAll({ limit: 10, offset: 0 }).sessions[0]?.cwd_exists).toBe(0);
  });

  test("recentSessions reports a deleted cwd as gone", () => {
    expect(setup().recentSessions(10)[0]?.cwd_exists).toBe(0);
  });

  test("an existing cwd still reports as present", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({
      session_id: "sid-here", agent: "claude", cwd: process.cwd(),
      last_activity: 1_000, cwd_exists: false, source: "scan",
    });
    expect(v.getSession("sid-here")?.cwd_exists).toBe(1);
  });
});
