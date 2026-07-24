import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAiTitleLine, parseClaudeJsonlLine } from "../src/sessions/parser";

const fix = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures/claude-jsonl", name), "utf8").trim();

describe("parseClaudeJsonlLine", () => {
  test("user-text → one user message, no tool calls", () => {
    const out = parseClaudeJsonlLine(fix("user-text.jsonl"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.session_id).toBe("sid-test-1");
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]!.role).toBe("user");
    expect(out.toolCalls).toHaveLength(0);
    expect(out.fts[0]!.text).toContain("hello, claude");
  });

  test("assistant-text → message with model + tokens extracted", () => {
    const out = parseClaudeJsonlLine(fix("assistant-text.jsonl"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = out.messages[0]!;
    expect(m.role).toBe("assistant");
    expect(m.model).toBe("claude-opus-4-7");
    expect(m.input_tokens).toBe(100);
    expect(m.output_tokens).toBe(5);
    expect(m.stop_reason).toBe("end_turn");
  });

  test("assistant-tool-use → tool_call started_at, no finished_at yet", () => {
    const out = parseClaudeJsonlLine(fix("assistant-tool-use.jsonl"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.toolCalls).toHaveLength(1);
    const tc = out.toolCalls[0]!;
    expect(tc.tool_name).toBe("Bash");
    expect(tc.tool_use_id).toBe("toolu_01");
    expect(tc.finished_at).toBeNull();
  });

  test("user-tool-result → toolResult patch matched by tool_use_id", () => {
    const out = parseClaudeJsonlLine(fix("user-tool-result.jsonl"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.toolResults).toHaveLength(1);
    expect(out.toolResults[0]!.tool_use_id).toBe("toolu_01");
    expect(out.toolResults[0]!.result_status).toBe("ok");
    expect(out.toolResults[0]!.result_size).toBeGreaterThan(0);
  });

  test("malformed line → ok=false with reason", () => {
    const out = parseClaudeJsonlLine(fix("malformed.jsonl"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/json|parse/i);
  });
});

describe("parseAiTitleLine", () => {
  test("ai-title line → session id + title", () => {
    const out = parseAiTitleLine(fix("ai-title.jsonl"));
    expect(out).toEqual({ session_id: "sid-test-1", title: "Sync claude.ai conversations" });
  });

  test("a normal user line → null", () => {
    expect(parseAiTitleLine(fix("user-text.jsonl"))).toBeNull();
  });

  test("malformed line → null", () => {
    expect(parseAiTitleLine(fix("malformed.jsonl"))).toBeNull();
  });

  test("ai-title with a blank title → null", () => {
    expect(parseAiTitleLine('{"type":"ai-title","aiTitle":"   ","sessionId":"s1"}')).toBeNull();
  });

  test("ai-title with a whitespace-only sessionId → null", () => {
    expect(parseAiTitleLine('{"type":"ai-title","aiTitle":"x","sessionId":"   "}')).toBeNull();
  });

  test("ai-title with a missing sessionId → null", () => {
    expect(parseAiTitleLine('{"type":"ai-title","aiTitle":"x"}')).toBeNull();
  });

  test("ai-title with a non-string sessionId → null", () => {
    expect(parseAiTitleLine('{"type":"ai-title","aiTitle":"x","sessionId":42}')).toBeNull();
  });
});
