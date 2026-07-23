import { describe, expect, test } from "bun:test";
import { renderDigest, buildPrompt } from "../src/sessions/summary-digest";

const line = (content: unknown, role = "user") =>
  JSON.stringify({ type: role, message: { role, content } });

const msg = (uuid: string | null, content: unknown, timestamp: number, role = "user") => ({
  uuid, role, content: line(content, role), timestamp,
});

describe("renderDigest", () => {
  test("renders one bracketed line per message and collects uuids", () => {
    const d = renderDigest([
      msg("u1", "hello there", 1),
      msg("u2", [{ type: "text", text: "hi back" }], 2, "assistant"),
    ]);
    expect(d.text).toContain("[u1] user: hello there");
    expect(d.text).toContain("[u2] assistant: hi back");
    expect([...d.uuids].sort()).toEqual(["u1", "u2"]);
    expect(d.includedCount).toBe(2);
  });

  test("tool calls render as name plus a short argument", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }], 1, "assistant"),
    ]);
    expect(d.text).toContain("<tool_use Bash bun test>");
  });

  test("tool results reduce to status and size, never their body", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_result", is_error: false, content: "x".repeat(5000) }], 1),
    ]);
    expect(d.text).toContain("<tool_result ok 5000b>");
    expect(d.text).not.toContain("xxxxxxxxxx");
  });

  test("errored tool results say error", () => {
    const d = renderDigest([
      msg("u1", [{ type: "tool_result", is_error: true, content: "boom" }], 1),
    ]);
    expect(d.text).toContain("<tool_result error 4b>");
  });

  test("tool result byte count is UTF-8 bytes, not UTF-16 code units", () => {
    const content = "🎉🎉🎉café";
    const expectedBytes = Buffer.byteLength(content, "utf8");
    // sanity: this string must actually expose the UTF-16/UTF-8 gap, or the
    // assertion below wouldn't distinguish a correct fix from a broken one.
    expect(expectedBytes).not.toBe(content.length);
    const d = renderDigest([
      msg("u1", [{ type: "tool_result", is_error: false, content }], 1),
    ]);
    expect(d.text).toContain(`<tool_result ok ${expectedBytes}b>`);
  });

  test("thinking blocks are dropped even when mixed with visible text", () => {
    const d = renderDigest([
      msg("u1", [
        { type: "thinking", thinking: "internal reasoning that should never surface" },
        { type: "text", text: "the actual reply" },
      ], 1, "assistant"),
    ]);
    expect(d.text).toContain("the actual reply");
    expect(d.text).not.toContain("internal reasoning");
  });

  test("a message containing only a thinking block is dropped entirely", () => {
    const d = renderDigest([
      msg("u1", [{ type: "thinking", thinking: "just thinking, nothing else" }], 1, "assistant"),
    ]);
    expect(d.uuids.has("u1")).toBe(false);
    expect(d.includedCount).toBe(0);
    expect(d.text).not.toContain("just thinking");
  });

  test("tool_use args are clipped to the first line and TOOL_ARG_MAX chars", () => {
    const longFirstLine = "x".repeat(100);
    const secondLine = "SECRET_SECOND_LINE_SHOULD_NOT_APPEAR";
    const d = renderDigest([
      msg("u1", [{ type: "tool_use", name: "Bash", input: { command: `${longFirstLine}\n${secondLine}` } }], 1, "assistant"),
    ]);
    expect(d.text).toContain(`<tool_use Bash ${"x".repeat(80)}…>`);
    expect(d.text).not.toContain(secondLine);
    expect(d.text).not.toContain(longFirstLine);
  });

  test("messages with no displayable text are dropped, uuid and all", () => {
    const d = renderDigest([
      { uuid: "u1", role: "permission-mode", content: '{"type":"permission-mode"}', timestamp: 1 },
      msg("u2", "real text", 2),
    ]);
    expect(d.uuids.has("u1")).toBe(false);
    expect(d.uuids.has("u2")).toBe(true);
    expect(d.includedCount).toBe(1);
  });

  test("messages without a uuid are dropped — they cannot be anchored", () => {
    const d = renderDigest([msg(null, "text with no uuid", 1)]);
    expect(d.includedCount).toBe(0);
  });

  test("a single huge message is clipped to the per-message cap", () => {
    const d = renderDigest([msg("u1", "y".repeat(5000), 1)]);
    expect(d.text.length).toBeLessThan(1400);
    expect(d.text).toContain("…");
  });

  test("over the total budget, head and tail are kept with an omission marker", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      msg(`u${i}`, `message number ${i} ` + "z".repeat(500), i),
    );
    const d = renderDigest(many);
    expect(d.text.length).toBeLessThanOrEqual(62_000);
    expect(d.text).toMatch(/… \d+ messages omitted …/);
    expect(d.text).toContain("[u0]");
    expect(d.text).toContain("[u399]");
    // dropped middle messages must not be citable
    expect(d.uuids.has("u200")).toBe(false);
    expect(d.uuids.has("u0")).toBe(true);
    expect(d.uuids.has("u399")).toBe(true);
  });

  test("under budget, nothing is omitted", () => {
    const d = renderDigest([msg("u1", "a", 1), msg("u2", "b", 2)]);
    expect(d.text).not.toContain("omitted");
  });
});

describe("buildPrompt", () => {
  test("includes the digest and demands verbatim uuids", () => {
    const p = buildPrompt("[u1] user: hi");
    expect(p).toContain("[u1] user: hi");
    expect(p).toContain("--- DIGEST ---");
    expect(p.toLowerCase()).toContain("uuid");
  });
});
