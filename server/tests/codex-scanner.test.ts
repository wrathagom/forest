import { describe, expect, test, spyOn } from "bun:test";
import { parseCodexRollout } from "../src/sessions/codex-scanner";

const rollout = [
  JSON.stringify({ timestamp: "2026-08-12T14:23:46.513Z", type: "session_meta",
    payload: { session_id: "cx-1", cwd: "/Users/me/studio", timestamp: "2026-08-12T14:23:46.513Z" } }),
  JSON.stringify({ timestamp: "2026-08-12T14:24:24.371Z", type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/Users/me/studio</cwd>\n</environment_context>" }] } }),
  JSON.stringify({ timestamp: "2026-08-12T14:24:30.000Z", type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "add better codex support" }] } }),
  JSON.stringify({ timestamp: "2026-08-12T14:25:00.000Z", type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "text", text: "on it" }] } }),
].join("\n");

describe("parseCodexRollout", () => {
  test("extracts meta, last activity, and first real user message", () => {
    const r = parseCodexRollout(rollout);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionId).toBe("cx-1");
    expect(r.cwd).toBe("/Users/me/studio");
    expect(r.startedAt).toBe(Date.parse("2026-08-12T14:23:46.513Z"));
    expect(r.lastEventAt).toBe(Date.parse("2026-08-12T14:25:00.000Z"));
    expect(r.lastUserMsg).toBe("add better codex support"); // env-context skipped
  });

  test("returns ok:false when session_meta is missing", () => {
    expect(parseCodexRollout('{"type":"response_item","payload":{}}').ok).toBe(false);
  });

  test("tolerates blank and malformed lines", () => {
    const text = "\n{not json}\n" + rollout;
    expect(parseCodexRollout(text).ok).toBe(true);
  });
});

import { buildCodexEntry } from "../src/sessions/codex-scanner";

const parsed = {
  ok: true as const,
  sessionId: "cx-1",
  cwd: "/Users/me/studio",
  startedAt: 1000,
  lastEventAt: 5000,
  lastUserMsg: "hello",
};
const projects = [{ id: "studio", path: "/Users/me/studio" }];
const projectName = (id: string) => (id === "studio" ? "Studio" : null);

describe("buildCodexEntry", () => {
  test("matched live terminal → focusable, working when fresh", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 10_000,
      projects,
      projectName,
      liveCodexTerminals: [{ ptySessionId: "pty-1", cwd: "/Users/me/studio", startedAt: 900 }],
    });
    expect(e.ptySessionId).toBe("pty-1");
    expect(e.endedAt).toBeNull();
    expect(e.state).toBe("working");
    expect(e.projectId).toBe("studio");
    expect(e.projectName).toBe("Studio");
    expect(e.worktreeLabel).toBe("main");
  });

  test("matched live terminal but idle → waiting", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 45_000,
      projects, projectName,
      liveCodexTerminals: [{ ptySessionId: "pty-1", cwd: "/Users/me/studio", startedAt: 900 }],
    });
    expect(e.state).toBe("waiting");
    expect(e.endedAt).toBeNull();
  });

  test("no terminal, recent activity → waiting, inert", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 30_000, projects, projectName, liveCodexTerminals: [],
    });
    expect(e.ptySessionId).toBeNull();
    expect(e.state).toBe("waiting");
    expect(e.endedAt).toBeNull();
  });

  test("no terminal, old activity → stale, closed", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 120_000, projects, projectName, liveCodexTerminals: [],
    });
    expect(e.ptySessionId).toBeNull();
    expect(e.state).toBe("stale");
    expect(e.endedAt).toBe(5000);
  });

  test("picks the most recent terminal when several share the cwd", () => {
    const e = buildCodexEntry(parsed, {
      now: 5000 + 10_000, projects, projectName,
      liveCodexTerminals: [
        { ptySessionId: "old", cwd: "/Users/me/studio", startedAt: 100 },
        { ptySessionId: "new", cwd: "/Users/me/studio", startedAt: 900 },
      ],
    });
    expect(e.ptySessionId).toBe("new");
  });
});

import { scanCodexSessions } from "../src/sessions/codex-scanner";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import * as fsNode from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scanCodexSessions", () => {
  test("parses recent rollouts and skips stale files", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
    const day = join(root, "2026", "08", "12");
    mkdirSync(day, { recursive: true });

    const fresh = join(day, "rollout-fresh.jsonl");
    writeFileSync(fresh, JSON.stringify({
      timestamp: "2026-08-12T14:23:46.513Z", type: "session_meta",
      payload: { session_id: "fresh-1", cwd: "/w/proj", timestamp: "2026-08-12T14:23:46.513Z" },
    }));

    const stale = join(day, "rollout-stale.jsonl");
    writeFileSync(stale, JSON.stringify({
      timestamp: "2020-01-01T00:00:00.000Z", type: "session_meta",
      payload: { session_id: "stale-1", cwd: "/w/proj", timestamp: "2020-01-01T00:00:00.000Z" },
    }));
    const old = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(stale, old, old);

    const applied: string[] = [];
    scanCodexSessions({
      sessionsRoot: root,
      now: Date.now(),
      liveWindowMs: 30 * 60_000,
      projects: [{ id: "proj", path: "/w/proj" }],
      projectName: () => "Proj",
      liveCodexTerminals: [],
      apply: (e) => applied.push(e.agentSessionId),
    });

    expect(applied).toContain("fresh-1");
    expect(applied).not.toContain("stale-1");
  });

  test("missing sessions root is a no-op", () => {
    let calls = 0;
    scanCodexSessions({
      sessionsRoot: "/no/such/dir/at/all",
      now: Date.now(), liveWindowMs: 1000,
      projects: [], projectName: () => null, liveCodexTerminals: [],
      apply: () => calls++,
    });
    expect(calls).toBe(0);
  });

  test("an unreadable subdirectory is skipped, not fatal to the rest of the scan", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-sessions-"));
    const goodDay = join(root, "2026", "08", "12");
    mkdirSync(goodDay, { recursive: true });
    writeFileSync(join(goodDay, "rollout-ok.jsonl"), JSON.stringify({
      timestamp: "2026-08-12T14:23:46.513Z", type: "session_meta",
      payload: { session_id: "ok-1", cwd: "/w/proj", timestamp: "2026-08-12T14:23:46.513Z" },
    }));

    // A directory that exists at listing time but throws when Codex (or a raced
    // deletion) makes it unreadable mid-scan — the guard must skip it, not abort.
    const brokenDir = join(root, "broken");
    mkdirSync(brokenDir, { recursive: true });

    const realReaddirSync = fsNode.readdirSync;
    const spy = spyOn(fsNode, "readdirSync").mockImplementation(((...args: unknown[]) => {
      if (args[0] === brokenDir) throw new Error("EACCES: permission denied, scandir");
      return (realReaddirSync as (...a: unknown[]) => unknown)(...args);
    }) as typeof fsNode.readdirSync);

    try {
      const applied: string[] = [];
      expect(() =>
        scanCodexSessions({
          sessionsRoot: root,
          now: Date.now(),
          liveWindowMs: 30 * 60_000,
          projects: [{ id: "proj", path: "/w/proj" }],
          projectName: () => "Proj",
          liveCodexTerminals: [],
          apply: (e) => applied.push(e.agentSessionId),
        }),
      ).not.toThrow();
      expect(applied).toContain("ok-1");
    } finally {
      spy.mockRestore();
    }
  });
});
