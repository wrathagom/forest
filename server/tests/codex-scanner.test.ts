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
