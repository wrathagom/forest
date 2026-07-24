import { describe, expect, test } from "bun:test";
import { stripFences, parseSummaryOutput, resultTextFromEnvelope } from "../src/sessions/summary-parse";

const valid = new Set(["u1", "u2", "u3"]);

describe("stripFences", () => {
  test("removes ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test("removes bare ``` fences", () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test("leaves unfenced text alone", () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });
  // Must call stripFences directly, not via parseSummaryOutput: the brace-extraction
  // fallback in parseSummaryOutput recovers the object even from a broken (e.g.
  // unanchored/non-greedy) stripFences match, which would mask this regression.
  test("embedded ``` inside a JSON string value does not truncate the match", () => {
    expect(stripFences('```json\n{"a":"has ``` here"}\n```')).toBe('{"a":"has ``` here"}');
  });
});

describe("resultTextFromEnvelope", () => {
  test("extracts .result from a success envelope", () => {
    const out = resultTextFromEnvelope(JSON.stringify({ subtype: "success", is_error: false, result: "hello" }));
    expect(out).toEqual({ ok: true, text: "hello" });
  });
  test("is_error true → failure carrying the message", () => {
    const out = resultTextFromEnvelope(JSON.stringify({ is_error: true, result: "Not logged in" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("Not logged in");
  });
  test("non-JSON stdout → failure with a user-facing reason", () => {
    const out = resultTextFromEnvelope("segfault");
    expect(out.ok).toBe(false);
    // Pinned exact copy: this is rendered verbatim in the UI, so a future
    // wording change should be a deliberate edit here, not a silent regression.
    if (!out.ok) expect(out.reason).toBe("Claude returned malformed output");
  });
  test("empty result text → failure with a user-facing reason", () => {
    const out = resultTextFromEnvelope(JSON.stringify({ result: "   " }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/no output/i);
  });
});

describe("parseSummaryOutput", () => {
  test("parses fenced JSON and keeps valid anchors", () => {
    const raw = '```json\n{"summary":"did things","moments":[{"uuid":"u1","label":"start"},{"uuid":"u2","label":"end"}]}\n```';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("did things");
    expect(out.moments).toEqual([{ uuid: "u1", label: "start" }, { uuid: "u2", label: "end" }]);
  });

  test("drops moments whose uuid is not in the digest", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"real"},{"uuid":"nope","label":"invented"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([{ uuid: "u1", label: "real" }]);
  });

  test("all anchors invalid → summary survives with zero moments", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"x","label":"a"},{"uuid":"y","label":"b"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });

  test("duplicate uuids are collapsed", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"a"},{"uuid":"u1","label":"b"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toHaveLength(1);
  });

  test("moments with a blank label are dropped", () => {
    const raw = '{"summary":"s","moments":[{"uuid":"u1","label":"  "}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });

  test("garbage with no braces at all → failure with the no-JSON-object reason", () => {
    const out = parseSummaryOutput("I'm afraid I can't do that", valid);
    expect(out.ok).toBe(false);
    // Pinned exact copy: this is the distinct "no braces found" message from
    // extractJsonPayload, threaded through the catch instead of being
    // collapsed to a generic string — the whole point of the fix. It's also
    // rendered verbatim in the UI, so wording changes should be deliberate.
    if (!out.ok) expect(out.reason).toBe("Claude's reply contained no JSON object");
  });

  test("braces present but the contents are still not valid JSON → failure with the generic reason", () => {
    // Has a `{` and a `}`, so it skips the no-braces case, but the sliced
    // substring itself doesn't parse — distinct from the garbage-with-no-braces case above.
    const out = parseSummaryOutput('Here is my answer for {the session}: {"summary":"s","moments":[]}', valid);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("Claude's reply wasn't valid JSON");
  });

  test("valid JSON that isn't an object → failure with a user-facing reason", () => {
    const out = parseSummaryOutput("42", valid);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/JSON object/i);
  });

  test("missing summary → failure with a user-facing reason", () => {
    const out = parseSummaryOutput('{"moments":[]}', valid);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/summary/i);
  });

  test("missing moments key → summary with zero moments", () => {
    const out = parseSummaryOutput('{"summary":"s"}', valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });

  test("an over-length label is clipped to 80 characters plus an ellipsis (81 chars total)", () => {
    const longLabel = "x".repeat(120);
    const raw = JSON.stringify({ summary: "s", moments: [{ uuid: "u1", label: longLabel }] });
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toHaveLength(1);
    const label = out.moments[0]!.label;
    expect(label).toBe("x".repeat(80) + "…");
    expect(label.length).toBe(81);
  });

  test("a non-object entry inside moments is skipped", () => {
    const raw = '{"summary":"s","moments":["not-an-object",{"uuid":"u1","label":"a"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("a non-array moments value degrades to an empty list, not a failure", () => {
    const raw = '{"summary":"s","moments":"not-an-array"}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });
});

describe("parseSummaryOutput: brace-extraction fallback for recoverable malformed output", () => {
  test("leading prose before a fenced block still parses", () => {
    const raw = 'Here is the JSON:\n```json\n{"summary":"s","moments":[{"uuid":"u1","label":"a"}]}\n```';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("s");
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("leading prose before bare (unfenced) JSON still parses", () => {
    const raw = 'Sure thing, here you go: {"summary":"s","moments":[{"uuid":"u1","label":"a"}]}';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("s");
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("trailing prose after a fenced block still parses", () => {
    const raw = '```json\n{"summary":"s","moments":[{"uuid":"u1","label":"a"}]}\n```\nHope that helps!';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("s");
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("uppercase ```JSON fence tag still parses", () => {
    const raw = '```JSON\n{"summary":"s","moments":[{"uuid":"u1","label":"a"}]}\n```';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("s");
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("~~~ fences still parse via the brace-extraction fallback", () => {
    const raw = '~~~json\n{"summary":"s","moments":[{"uuid":"u1","label":"a"}]}\n~~~';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("s");
    expect(out.moments).toEqual([{ uuid: "u1", label: "a" }]);
  });

  test("genuinely non-JSON prose still fails even with the fallback", () => {
    const out = parseSummaryOutput("I'm afraid I can't do that", valid);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/JSON/i);
  });

  test("a JSON string value containing a ``` sequence still parses (regression guard)", () => {
    const raw = '```json\n{"summary":"has ``` inside the text","moments":[]}\n```';
    const out = parseSummaryOutput(raw, valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toBe("has ``` inside the text");
  });
});
