import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    await s.idle();
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
    await s.idle();
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
    const s = make(spawn);
    await s.request("s1");
    await s.idle();
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

  // The subprocess loads the user's real config dir (credentials live there),
  // so it would otherwise launch every MCP server they have configured for a
  // one-shot summary.
  test("suppresses the user's MCP servers", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.idle();
    expect(spawn.calls[0]!.cmd).toContain("--strict-mcp-config");
  });

  test("borrows the config dir matching the session's profile", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "work",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn, {
      claudeConfigDirs: () => [
        { path: "/home/u/.claude", profile: "default" },
        { path: "/home/u/.claude-work", profile: "work" },
      ],
    });
    await s.request("s1");
    await s.idle();
    expect(spawn.calls[0]!.env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-work");
  });

  test("an unknown profile falls back to the first config dir", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "ghost",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.idle();
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
    await s.idle();
    await s.request("s1");
    await s.idle();
    expect(spawn.calls).toHaveLength(1);
  });

  test("force regenerates", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.idle();
    await s.request("s1", { force: true });
    await s.idle();
    expect(spawn.calls).toHaveLength(2);
  });

  test("a non-zero exit is stored as an error and not retried", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn("", 1);
    const s = make(spawn);
    await s.request("s1");
    await s.idle();
    expect(s.status("s1").status).toBe("error");
    await s.request("s1");
    await s.idle();
    expect(spawn.calls).toHaveLength(1);
  });

  test("unparseable model output is stored as an error", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope("sorry, I cannot")));
    await s.request("s1");
    await s.idle();
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("JSON");
  });

  // The persisted reason is user-facing prose; the raw stdout is the only thing
  // that explains what the model actually said, so it must reach the log.
  test("unparseable model output logs the raw stdout", async () => {
    seed("s1", 10);
    const lines: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
    const s = make(fakeSpawn(envelope("sorry, I cannot do that")), {
      log: (level, msg, meta) => lines.push({ level, msg, meta }),
    });
    await s.request("s1");
    await s.idle();
    const warn = lines.find((l) => l.level === "warn" && l.msg.includes("unusable stdout"));
    expect(warn).toBeDefined();
    expect(String(warn!.meta!.stdout)).toContain("sorry, I cannot do that");
    expect(warn!.meta!.runId).toBeTruthy();
  });

  test("invented anchors are dropped, the summary survives", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope('{"summary":"kept","moments":[{"uuid":"made-up","label":"nope"}]}')));
    await s.request("s1");
    await s.idle();
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
    await s.request("s1");
    expect((await s.request("s1")).status).toBe("pending");
    expect(b.count()).toBe(1);
    b.release({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" });
    await s.idle();
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

  // (a) The cap must not merely delay the third run — it must eventually run it.
  test("a queued run starts once a slot frees, and every run is stored", async () => {
    seed("s1", 10); seed("s2", 10); seed("s3", 10);
    const spawns: Array<{ cmd: string[]; release: () => void }> = [];
    const spawn: SummarizerSpawnFn = (opts) => {
      let release!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { release = r; });
      spawns.push({
        cmd: opts.cmd,
        release: () => release({ code: 0, stdout: envelope('{"summary":"done","moments":[]}'), stderr: "" }),
      });
      return { exited, kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 2 });
    await Promise.all([s.request("s1"), s.request("s2"), s.request("s3")]);
    expect(spawns).toHaveLength(2);

    spawns[0]!.release();
    // Let the finished run's `finally` drain the queue and the queued run spawn.
    await new Promise((r) => setTimeout(r, 0));
    expect(spawns).toHaveLength(3);

    spawns[1]!.release();
    spawns[2]!.release();
    await s.idle();

    for (const id of ["s1", "s2", "s3"]) {
      const st = s.status(id);
      expect(st.status).toBe("ready");
      expect(st.summary).toBe("done");
    }
  });

  // The cap must survive the FIRST completion. Draining the queue by reading
  // `running.size` released every waiter at once, because the size doesn't grow
  // until each released continuation resumes a microtask later.
  test("the cap holds beyond the first completion", async () => {
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
    for (const id of ids) seed(id, 10);
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const spawn: SummarizerSpawnFn = () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      let resolve!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { resolve = r; });
      let released = false;
      releases.push(() => {
        if (released) return;
        released = true;
        inFlight--;
        resolve({ code: 0, stdout: envelope('{"summary":"done","moments":[]}'), stderr: "" });
      });
      return { exited, kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 2 });
    await Promise.all(ids.map((id) => s.request(id)));
    for (let i = 0; i < 20; i++) {
      for (const r of [...releases]) r();
      await new Promise((r) => setTimeout(r, 1));
    }
    await s.idle();
    expect(releases).toHaveLength(6);
    expect(peak).toBe(2);
  });

  // Admission is claimed at request time, so a duplicate request for a session
  // that is merely QUEUED is deduped too — not just one already spawned.
  test("a session requested twice while queued only spawns once", async () => {
    seed("a", 10); seed("b", 10);
    const releases: Array<() => void> = [];
    const spawn: SummarizerSpawnFn = () => {
      let resolve!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { resolve = r; });
      releases.push(() => resolve({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" }));
      return { exited, kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    await s.request("a"); // takes the only slot
    await s.request("b"); // queued
    const pb2 = await s.request("b"); // must NOT enqueue a second run for b
    expect(releases).toHaveLength(1);
    expect(pb2.status).toBe("pending");
    for (let i = 0; i < 10; i++) {
      for (const r of [...releases]) r();
      await new Promise((r) => setTimeout(r, 1));
    }
    await s.idle();
    expect(releases).toHaveLength(2); // a and b — never b twice
  });

  test("shutdown settles queued requests without spawning them", async () => {
    seed("a", 10); seed("b", 10);
    let spawns = 0;
    const spawn: SummarizerSpawnFn = () => {
      spawns++;
      let resolve!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { resolve = r; });
      // As in reality: shutdown's SIGTERM is what makes the child exit.
      return { exited, kill: () => resolve({ code: 143, stdout: "", stderr: "" }) };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    await s.request("a");
    await s.request("b"); // queued behind a
    expect(spawns).toBe(1);

    s.shutdown();
    // The queued waiter must resume and return; a discarded resolver would
    // leave its `run()` frame unsettled forever. Timeout guard: a regression
    // must fail this test, not hang the suite.
    const outcome = await Promise.race([
      s.idle().then(() => "settled"),
      new Promise((r) => setTimeout(() => r("hung"), 250)),
    ]);
    expect(outcome).toBe("settled");
    expect(spawns).toBe(1);
  });

  // Invariant 2: `activeSlots` == slots held. `drain()` grants a slot before
  // resuming a waiter; if shutdown lands in that window the waiter must give
  // the slot back rather than bail with it still counted.
  test("a shutdown that races a queue handover does not leak a slot", async () => {
    seed("a", 10); seed("b", 10);
    const releases: Array<() => void> = [];
    const spawn: SummarizerSpawnFn = () => {
      let resolve!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { resolve = r; });
      releases.push(() => resolve({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" }));
      return { exited, kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    await s.request("a");
    await s.request("b"); // queued
    s.shutdown();
    releases[0]!(); // the running child exits after shutdown was requested
    const outcome = await Promise.race([
      s.idle().then(() => "settled"),
      new Promise((r) => setTimeout(() => r("hung"), 250)),
    ]);
    expect(outcome).toBe("settled");
    // Nothing is claimed and nothing is running: both sessions are releasable.
    expect(s.status("a").status).not.toBe("pending");
    expect(s.status("b").status).not.toBe("pending");
  });

  // (b) The timeout path: no given test covered it.
  test("a run that overruns the timeout is killed and stored as an error", async () => {
    seed("s1", 10);
    let killed = 0;
    const calls: string[][] = [];
    const spawn: SummarizerSpawnFn = (opts) => {
      calls.push(opts.cmd);
      let resolve!: (v: { code: number; stdout: string; stderr: string }) => void;
      const exited = new Promise<{ code: number; stdout: string; stderr: string }>((r) => { resolve = r; });
      return {
        exited,
        // A real SIGTERM makes the child exit, which is what unblocks `exited`.
        kill: () => { killed++; resolve({ code: 143, stdout: "", stderr: "" }); },
      };
    };
    const s = make(spawn, { timeoutMs: 20 });
    await s.request("s1");
    await s.idle();
    expect(killed).toBe(1);
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("timed out");
    // Stored, therefore never re-burned on the next page view.
    await s.request("s1");
    await s.idle();
    expect(calls).toHaveLength(1);
  });

  // (c) A spawn that throws must not leak a concurrency slot. (Whether it is
  //     persisted is covered in "pre-spawn failures are not cached" — it is not.)
  test("a spawn that throws releases its slot", async () => {
    seed("s1", 10); seed("s2", 10);
    let first = true;
    const good = envelope('{"summary":"second ran","moments":[]}');
    const spawn: SummarizerSpawnFn = () => {
      if (first) { first = false; throw new Error("ENOENT: claude not found"); }
      return { exited: Promise.resolve({ code: 0, stdout: good, stderr: "" }), kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    await s.request("s1");
    await s.idle();
    const st1 = s.status("s1");
    expect(st1.status).toBe("error");
    expect(st1.error).toContain("claude not found");

    await s.request("s2");
    await s.idle();
    expect(s.status("s2").status).toBe("ready");
    expect(s.status("s2").summary).toBe("second ran");
  });
});

describe("observability", () => {
  function capture() {
    const lines: Array<{ level: string; msg: string; meta: Record<string, unknown> }> = [];
    const log = (level: string, msg: string, meta?: Record<string, unknown>) =>
      lines.push({ level, msg, meta: meta ?? {} });
    return { lines, log };
  }

  // Every run costs money; without this there is no record one happened.
  test("a successful run logs sessionId, runId, code, duration, model and config dir", async () => {
    seed("s1", 10);
    const { lines, log } = capture();
    const s = make(fakeSpawn(envelope('{"summary":"x","moments":[{"uuid":"u1","label":"a"}]}')), { log });
    await s.request("s1");
    await s.idle();

    const done = lines.find((l) => l.msg === "summarizer run finished");
    expect(done).toBeDefined();
    expect(done!.level).toBe("info");
    expect(done!.meta.sessionId).toBe("s1");
    expect(done!.meta.runId).toBeTruthy();
    expect(done!.meta.code).toBe(0);
    expect(typeof done!.meta.durationMs).toBe("number");
    expect(done!.meta.model).toBe("claude-haiku-4-5-20251001");
    expect(done!.meta.configDir).toBe("/home/u/.claude");
    expect(done!.meta.profile).toBe("default");
    expect(done!.meta.outcome).toBe("ok");

    // The runId is the only handle on the subprocess and the transcript it
    // wrote, so it must appear before the run can hang, not only after.
    const started = lines.find((l) => l.msg === "summarizer run started");
    expect(started!.meta.runId).toBe(done!.meta.runId);
    expect(started!.meta.configDir).toBe("/home/u/.claude");
  });

  test("a failing run logs the reason alongside runId and config dir", async () => {
    seed("s1", 10);
    const { lines, log } = capture();
    const spawn: SummarizerSpawnFn = () => ({
      exited: Promise.resolve({ code: 2, stdout: "", stderr: "Not logged in" }),
      kill: () => {},
    });
    const s = make(spawn, { log });
    await s.request("s1");
    await s.idle();

    const done = lines.find((l) => l.msg === "summarizer run finished")!;
    expect(done.level).toBe("warn");
    expect(done.meta.code).toBe(2);
    expect(done.meta.outcome).toBe("error");
    expect(String(done.meta.reason)).toContain("Not logged in");
    expect(done.meta.runId).toBeTruthy();
    expect(done.meta.configDir).toBe("/home/u/.claude");
  });

  test("transcript cleanup failures name the config dir and run id", async () => {
    seed("s1", 10);
    const { lines, log } = capture();
    // A path that exists but cannot be listed as a directory makes readdirSync throw.
    const home = mkdtempSync(join(tmpdir(), "forest-summarizer-log-"));
    mkdirSync(join(home, "projects"), { recursive: true });
    rmSync(join(home, "projects"), { recursive: true, force: true });
    writeFileSync(join(home, "projects"), "not a directory");
    const s = make(fakeSpawn(envelope('{"summary":"x","moments":[]}')), {
      log, claudeConfigDirs: () => [{ path: home, profile: "default" }],
    });
    await s.request("s1");
    await s.idle();

    const warn = lines.find((l) => l.msg.includes("transcript cleanup failed"));
    expect(warn).toBeDefined();
    expect(warn!.meta.configDir).toBe(home);
    expect(warn!.meta.runId).toBeTruthy();
    rmSync(home, { recursive: true, force: true });
  });
});

/** Let fire-and-forget work reach a terminal state without depending on
 *  microtask counts. Generous enough for a queued run to spawn and settle. */
async function settle(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 2));
}

describe("fire-and-forget admission", () => {
  // POST /summary must not block for the ~18s a run costs — ngrok's HTTP
  // timeout is 60s and a queued run can take twice the per-run time.
  test("request returns pending immediately without awaiting the run", async () => {
    seed("s1", 10);
    const b = blockingSpawn();
    const s = make(b.fn);
    const started = Date.now();
    expect((await s.request("s1")).status).toBe("pending");
    expect(Date.now() - started).toBeLessThan(50);
    expect(s.status("s1").status).toBe("pending");
    b.release({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" });
    await s.idle();
    expect(s.status("s1").status).toBe("ready");
  });

  // Fire-and-forget is only safe if the backlog is bounded: nothing upstream
  // throttles POSTs any more, and every admitted run costs ~$0.04.
  test("the queue is capped and further requests are rejected, not admitted", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `q${i}`);
    for (const id of ids) seed(id, 10);
    const b = blockingSpawn();
    const s = make(b.fn, { maxConcurrent: 1, maxQueue: 3 });

    // 1 running + 3 queued = the whole allowance.
    for (const id of ids.slice(0, 4)) {
      expect((await s.request(id)).status).toBe("pending");
    }
    const rejected = await s.request("q4");
    expect(rejected.status).toBe("error");
    expect(rejected.error).toMatch(/busy|queue/i);
    // A rejection is not an admission: nothing spawned, nothing claimed,
    // and nothing was written to the cache for it.
    expect(b.count()).toBe(1);
    expect(vault.getSummary("q4")).toBeUndefined();

    // ...and once the backlog drains, the same session is admitted again.
    b.release({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" });
    await settle();
    expect((await s.request("q4")).status).toBe("pending");
  });

  test("a rejected request leaves no stored row and is retried later", async () => {
    seed("s1", 10);
    const b = blockingSpawn();
    const s = make(b.fn, { maxConcurrent: 1, maxQueue: 0 });
    expect((await s.request("s1")).status).toBe("pending");
    seed("s2", 10);
    expect((await s.request("s2")).status).toBe("error");
    expect(vault.getSummary("s2")).toBeUndefined();
    expect(s.status("s2").status).toBe("absent");
  });
});

describe("hard deadline", () => {
  // The single SIGTERM was advisory: a child that ignores it leaves
  // `await proc.exited` pending forever, holding its slot and its `claimed`
  // entry — the one way `claimed` can leak permanently.
  test("a child that never exits and ignores kill still releases its slot", async () => {
    seed("s1", 10); seed("s2", 10);
    const spawned: string[] = [];
    let sawKill = 0;
    const spawn: SummarizerSpawnFn = (opts) => {
      const runId = opts.cmd[opts.cmd.indexOf("--session-id") + 1]!;
      spawned.push(runId);
      // Second run behaves; the first is the hung one.
      if (spawned.length > 1) {
        return {
          exited: Promise.resolve({ code: 0, stdout: envelope('{"summary":"second","moments":[]}'), stderr: "" }),
          kill: () => {},
        };
      }
      // Ignores every signal and never exits.
      return { exited: new Promise(() => {}), kill: () => { sawKill++; } };
    };
    const s = make(spawn, { maxConcurrent: 1, timeoutMs: 10, killGraceMs: 10 });
    await s.request("s1");
    await settle();

    expect(sawKill).toBeGreaterThan(0);
    // The slot and the claim are both back.
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toMatch(/timed out/);

    // Proof the slot is really free: the next session runs to completion.
    await s.request("s2");
    await settle();
    expect(s.status("s2").status).toBe("ready");
    expect(s.status("s2").summary).toBe("second");
  });
});

describe("pre-spawn failures are not cached", () => {
  // A run that never spawned cost nothing, and its causes (PATH not populated
  // at boot, a config dir not yet discovered) are transient. Persisting them
  // poisons the cache until the user finds the Retry button.
  test("a spawn that throws stores no row and is retried on the next request", async () => {
    seed("s1", 10);
    let attempts = 0;
    const good = envelope('{"summary":"eventually","moments":[]}');
    const spawn: SummarizerSpawnFn = () => {
      attempts++;
      if (attempts === 1) throw new Error("ENOENT: claude not found");
      return { exited: Promise.resolve({ code: 0, stdout: good, stderr: "" }), kill: () => {} };
    };
    const s = make(spawn);
    await s.request("s1");
    await settle();

    // Reported, but nothing persisted.
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("claude not found");
    expect(vault.getSummary("s1")).toBeUndefined();

    // No `force` needed — a plain request retries, because nothing is cached.
    await s.request("s1");
    await settle();
    expect(attempts).toBe(2);
    expect(s.status("s1").status).toBe("ready");
    expect(s.status("s1").summary).toBe("eventually");
  });

  test("no config dir stores no row and is retried once one appears", async () => {
    seed("s1", 10);
    let dirs: Array<{ path: string; profile: string }> = [];
    const spawn = fakeSpawn(envelope('{"summary":"after","moments":[]}'));
    const s = make(spawn, { claudeConfigDirs: () => dirs });

    const first = await s.request("s1");
    expect(first.status).toBe("error");
    expect(first.error).toContain("config dir");
    expect(vault.getSummary("s1")).toBeUndefined();
    expect(spawn.calls).toHaveLength(0);

    dirs = [{ path: "/home/u/.claude", profile: "default" }];
    await s.request("s1");
    await settle();
    expect(spawn.calls).toHaveLength(1);
    expect(s.status("s1").status).toBe("ready");
  });

  // The other side of the rule: once money has been spent, the outcome IS
  // persisted, so a page view never silently re-burns $0.04.
  test("a post-spawn failure is still persisted and not retried", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn("", 1);
    const s = make(spawn);
    await s.request("s1");
    await settle();
    expect(vault.getSummary("s1")).toBeDefined();
    expect(s.status("s1").status).toBe("error");
    await s.request("s1");
    await settle();
    expect(spawn.calls).toHaveLength(1);
  });
});

describe("transcript cleanup", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "forest-summarizer-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  // (d) The summarizer's own transcript must not survive the run.
  test("deletes the transcript this run wrote", async () => {
    seed("s1", 10);
    mkdirSync(join(home, "projects", "-data-summarizer"), { recursive: true });
    let written = "";
    const spawn: SummarizerSpawnFn = (opts) => {
      const runId = opts.cmd[opts.cmd.indexOf("--session-id") + 1]!;
      written = join(home, "projects", "-data-summarizer", `${runId}.jsonl`);
      writeFileSync(written, '{"type":"user"}\n');
      return {
        exited: Promise.resolve({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" }),
        kill: () => {},
      };
    };
    const s = make(spawn, { claudeConfigDirs: () => [{ path: home, profile: "default" }] });
    await s.request("s1");
    await s.idle();
    expect(written).not.toBe("");
    expect(existsSync(written)).toBe(false);
  });

  test("leaves an unrelated transcript alone", async () => {
    seed("s1", 10);
    const dir = join(home, "projects", "-data-summarizer");
    mkdirSync(dir, { recursive: true });
    const other = join(dir, "someone-elses-session.jsonl");
    writeFileSync(other, "{}\n");
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn, { claudeConfigDirs: () => [{ path: home, profile: "default" }] });
    await s.request("s1");
    await s.idle();
    expect(existsSync(other)).toBe(true);
  });

  test("does not throw when the projects dir is missing", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn, { claudeConfigDirs: () => [{ path: join(home, "nope"), profile: "default" }] });
    await s.request("s1");
    await s.idle();
    expect(s.status("s1").status).toBe("ready");
  });
});
