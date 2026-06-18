import { test, expect } from "vitest";
import { parseMessageContent, isMechanicalMessage } from "../src/lib/transcript";

const env = (msgContent: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: msgContent }, ...extra });

test("plain string content (not JSON) becomes a single text block", () => {
  expect(parseMessageContent("hello there")).toEqual([{ kind: "text", text: "hello there" }]);
});

test("string content inside the message envelope becomes a text block", () => {
  expect(parseMessageContent(env("just words"))).toEqual([{ kind: "text", text: "just words" }]);
});

test("array content with text blocks", () => {
  const raw = env([{ type: "text", text: "first" }, { type: "text", text: "second" }]);
  expect(parseMessageContent(raw)).toEqual([
    { kind: "text", text: "first" },
    { kind: "text", text: "second" },
  ]);
});

test("tool_use block becomes a tool_use block with a name and a derived summary", () => {
  const raw = env([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git status" } }]);
  expect(parseMessageContent(raw)).toEqual([
    { kind: "tool_use", name: "Bash", summary: "git status" },
  ]);
});

test("tool_use summary uses file_path for Edit/Write/Read", () => {
  const raw = env([{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/a/b/c.ts", old_string: "x", new_string: "y" } }]);
  expect(parseMessageContent(raw)).toEqual([{ kind: "tool_use", name: "Edit", summary: "/a/b/c.ts" }]);
});

test("tool_use with no recognizable summary field has a null summary", () => {
  const raw = env([{ type: "tool_use", id: "t1", name: "SomethingElse", input: { foo: 1 } }]);
  expect(parseMessageContent(raw)).toEqual([{ kind: "tool_use", name: "SomethingElse", summary: null }]);
});

test("long tool_use summaries are truncated", () => {
  const long = "echo " + "x".repeat(300);
  const raw = env([{ type: "tool_use", id: "t1", name: "Bash", input: { command: long } }]);
  const blocks = parseMessageContent(raw);
  expect(blocks[0]).toMatchObject({ kind: "tool_use", name: "Bash" });
  const summary = (blocks[0] as { summary: string }).summary;
  expect(summary.length).toBeLessThanOrEqual(121);
  expect(summary.endsWith("…")).toBe(true);
});

test("tool_result with string content becomes a tool_result block", () => {
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file1\nfile2\n", is_error: false }] } });
  expect(parseMessageContent(raw)).toEqual([
    { kind: "tool_result", isError: false, preview: "file1" },
  ]);
});

test("tool_result error is flagged", () => {
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true }] } });
  expect(parseMessageContent(raw)).toEqual([{ kind: "tool_result", isError: true, preview: "boom" }]);
});

test("tool_result with array content flattens text parts", () => {
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "line one\nline two" }] }] } });
  expect(parseMessageContent(raw)).toEqual([{ kind: "tool_result", isError: false, preview: "line one" }]);
});

test("thinking blocks are dropped", () => {
  const raw = env([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "answer" }]);
  expect(parseMessageContent(raw)).toEqual([{ kind: "text", text: "answer" }]);
});

test("unknown block kinds fall back to a text block with the JSON", () => {
  const raw = env([{ type: "weird", data: 1 }]);
  const blocks = parseMessageContent(raw);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.kind).toBe("text");
});

test("empty / whitespace text blocks are dropped", () => {
  const raw = env([{ type: "text", text: "   " }, { type: "text", text: "real" }]);
  expect(parseMessageContent(raw)).toEqual([{ kind: "text", text: "real" }]);
});

test("isMechanicalMessage: true when every block is a tool_result", () => {
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  expect(isMechanicalMessage(parseMessageContent(raw))).toBe(true);
});

test("isMechanicalMessage: false when there is a text block", () => {
  expect(isMechanicalMessage(parseMessageContent("hi"))).toBe(false);
});

test("isMechanicalMessage: false for an empty block list", () => {
  expect(isMechanicalMessage([])).toBe(false);
});
