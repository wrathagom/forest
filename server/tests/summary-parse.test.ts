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
  test("non-JSON stdout → failure", () => {
    expect(resultTextFromEnvelope("segfault").ok).toBe(false);
  });
  test("empty result text → failure", () => {
    expect(resultTextFromEnvelope(JSON.stringify({ result: "   " })).ok).toBe(false);
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

  test("garbage → failure", () => {
    expect(parseSummaryOutput("I'm afraid I can't do that", valid).ok).toBe(false);
  });

  test("missing summary → failure", () => {
    expect(parseSummaryOutput('{"moments":[]}', valid).ok).toBe(false);
  });

  test("missing moments key → summary with zero moments", () => {
    const out = parseSummaryOutput('{"summary":"s"}', valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moments).toEqual([]);
  });
});
