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
    await make(spawn).request("s1");
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

  test("borrows the config dir matching the session's profile", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "work",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    await make(spawn, {
      claudeConfigDirs: () => [
        { path: "/home/u/.claude", profile: "default" },
        { path: "/home/u/.claude-work", profile: "work" },
      ],
    }).request("s1");
    expect(spawn.calls[0]!.env.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-work");
  });

  test("an unknown profile falls back to the first config dir", async () => {
    seed("s1", 10);
    vault.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/proj",
      last_activity: 1000, source: "scan", profile: "ghost",
    });
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    await make(spawn).request("s1");
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
    await s.request("s1");
    expect(spawn.calls).toHaveLength(1);
  });

  test("force regenerates", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn);
    await s.request("s1");
    await s.request("s1", { force: true });
    expect(spawn.calls).toHaveLength(2);
  });

  test("a non-zero exit is stored as an error and not retried", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn("", 1);
    const s = make(spawn);
    await s.request("s1");
    expect(s.status("s1").status).toBe("error");
    await s.request("s1");
    expect(spawn.calls).toHaveLength(1);
  });

  test("unparseable model output is stored as an error", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope("sorry, I cannot")));
    await s.request("s1");
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("JSON");
  });

  test("invented anchors are dropped, the summary survives", async () => {
    seed("s1", 10);
    const s = make(fakeSpawn(envelope('{"summary":"kept","moments":[{"uuid":"made-up","label":"nope"}]}')));
    await s.request("s1");
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
    const first = s.request("s1");
    expect((await s.request("s1")).status).toBe("pending");
    expect(b.count()).toBe(1);
    b.release({ code: 0, stdout: envelope('{"summary":"x","moments":[]}'), stderr: "" });
    await first;
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
    const all = Promise.all([s.request("s1"), s.request("s2"), s.request("s3")]);
    await Promise.resolve();
    expect(spawns).toHaveLength(2);

    spawns[0]!.release();
    // Let the finished run's `finally` drain the queue and the queued run spawn.
    await new Promise((r) => setTimeout(r, 0));
    expect(spawns).toHaveLength(3);

    spawns[1]!.release();
    spawns[2]!.release();
    await all;

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
    const all = Promise.all(ids.map((id) => s.request(id)));
    for (let i = 0; i < 20; i++) {
      for (const r of [...releases]) r();
      await new Promise((r) => setTimeout(r, 1));
    }
    await all;
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
    const pa = s.request("a"); // takes the only slot
    const pb1 = s.request("b"); // queued
    const pb2 = s.request("b"); // must NOT enqueue a second run for b
    await Promise.resolve();
    expect(releases).toHaveLength(1);
    expect((await pb2).status).toBe("pending");
    for (let i = 0; i < 10; i++) {
      for (const r of [...releases]) r();
      await new Promise((r) => setTimeout(r, 1));
    }
    await Promise.all([pa, pb1, pb2]);
    expect(releases).toHaveLength(2); // a and b — never b twice
  });

  test("shutdown settles queued requests without spawning them", async () => {
    seed("a", 10); seed("b", 10);
    let spawns = 0;
    const spawn: SummarizerSpawnFn = () => {
      spawns++;
      return { exited: new Promise(() => {}), kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    void s.request("a");
    const queued = s.request("b");
    await Promise.resolve();
    expect(spawns).toBe(1);

    s.shutdown();
    // Timeout guard: a regression must fail this test, not hang the suite.
    const outcome = await Promise.race([
      queued.then(() => "settled"),
      new Promise((r) => setTimeout(() => r("hung"), 250)),
    ]);
    expect(outcome).toBe("settled");
    expect(spawns).toBe(1);
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
    expect(killed).toBe(1);
    const st = s.status("s1");
    expect(st.status).toBe("error");
    expect(st.error).toContain("timed out");
    // Stored, therefore never re-burned on the next page view.
    await s.request("s1");
    expect(calls).toHaveLength(1);
  });

  // (c) A spawn that throws must be stored, and must not leak a concurrency slot.
  test("a spawn that throws is stored and releases its slot", async () => {
    seed("s1", 10); seed("s2", 10);
    let first = true;
    const good = envelope('{"summary":"second ran","moments":[]}');
    const spawn: SummarizerSpawnFn = () => {
      if (first) { first = false; throw new Error("ENOENT: claude not found"); }
      return { exited: Promise.resolve({ code: 0, stdout: good, stderr: "" }), kill: () => {} };
    };
    const s = make(spawn, { maxConcurrent: 1 });
    await s.request("s1");
    const st1 = s.status("s1");
    expect(st1.status).toBe("error");
    expect(st1.error).toContain("claude not found");

    await s.request("s2");
    expect(s.status("s2").status).toBe("ready");
    expect(s.status("s2").summary).toBe("second ran");
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
    await make(spawn, { claudeConfigDirs: () => [{ path: home, profile: "default" }] }).request("s1");
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
    await make(spawn, { claudeConfigDirs: () => [{ path: home, profile: "default" }] }).request("s1");
    expect(existsSync(other)).toBe(true);
  });

  test("does not throw when the projects dir is missing", async () => {
    seed("s1", 10);
    const spawn = fakeSpawn(envelope('{"summary":"x","moments":[]}'));
    const s = make(spawn, { claudeConfigDirs: () => [{ path: join(home, "nope"), profile: "default" }] });
    await s.request("s1");
    expect(s.status("s1").status).toBe("ready");
  });
});
