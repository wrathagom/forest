// Mechanically enforces the one-directional invariant between the server's
// digest filter and the frontend's rendering filter: the server must never
// treat a message as citable when the frontend would give it zero DOM nodes.
//
// The two implementations are independently written (there's no shared code
// to keep them honest), so this test imports both directly — including the
// frontend module straight out of web/src — rather than duplicating either
// one's logic as a hand-maintained fixture set.
import { describe, expect, test } from "bun:test";
import { displayText } from "../src/sessions/summary-digest";
import { parseMessageContent } from "../../web/src/lib/transcript";

const envelope = (content: unknown, role = "user") =>
  JSON.stringify({ type: role, message: { role, content } });

const fixtures: Array<{ name: string; line: string }> = [
  { name: "plain string content", line: envelope("hello there") },
  { name: "text block", line: envelope([{ type: "text", text: "hi back" }], "assistant") },
  {
    name: "tool_use block",
    line: envelope([{ type: "tool_use", name: "Bash", input: { command: "ls" } }], "assistant"),
  },
  {
    name: "tool_result block (ok)",
    line: envelope([{ type: "tool_result", is_error: false, content: "output" }]),
  },
  {
    name: "tool_result block (error)",
    line: envelope([{ type: "tool_result", is_error: true, content: "boom" }]),
  },
  {
    name: "thinking-only content",
    line: envelope([{ type: "thinking", thinking: "secret reasoning" }], "assistant"),
  },
  {
    name: "redacted_thinking-only content",
    line: envelope([{ type: "redacted_thinking", data: "opaque" }], "assistant"),
  },
  {
    // The one KNOWN, SAFE divergence: the frontend renders an unrecognized
    // block type via a JSON.stringify fallback (so it still gets a DOM
    // node), while the server's displayText deliberately drops unknown
    // block types entirely. That makes the frontend MORE permissive here,
    // which is the safe direction — the invariant this suite enforces is
    // one-directional (server text non-empty implies frontend has a
    // block), so this fixture's implication holds vacuously (server text is
    // "") without asserting the two agree. Do not turn this into an
    // equality assertion; that would require the server to start rendering
    // block types it has never seen before, which is exactly what the
    // conservative-by-default design is trying to avoid.
    name: "unknown/future block type",
    line: envelope(
      [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } }],
      "assistant",
    ),
  },
  { name: "empty content array", line: envelope([]) },
  {
    // No nested `message` object — content sits at the top level instead.
    // The frontend falls back to reading `obj.content` directly in this
    // case; the server's displayText only ever looks at `message.content`
    // and treats this as non-displayable (the safe, conservative direction).
    name: "missing message wrapper",
    line: JSON.stringify({ type: "user", content: "hello no wrapper" }),
  },
  {
    name: "malformed JSON",
    line: '{"type":"user","message":{"role":"user","content":"broken',
  },
  { name: "bare non-JSON string", line: "just some plain text, not json at all" },
];

describe("displayText is never more permissive than parseMessageContent", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      const serverText = displayText(f.line);
      const frontendBlocks = parseMessageContent(f.line);
      if (serverText.length > 0) {
        expect(frontendBlocks.length).toBeGreaterThan(0);
      }
    });
  }
});
