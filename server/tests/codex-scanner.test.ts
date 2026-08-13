import { describe, expect, test } from "bun:test";
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
