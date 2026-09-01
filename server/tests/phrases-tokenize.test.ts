import { describe, expect, test } from "bun:test";
import {
  assistantProseText,
  sentences,
  tokenize,
  ngrams,
  isAllStopwords,
  extractPhrases,
} from "../src/phrases/tokenize";

function assistantLine(blocks: unknown[]): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    cwd: "/tmp",
    timestamp: "2026-06-01T00:00:00Z",
    uuid: "u1",
    message: { role: "assistant", content: blocks },
  });
}

describe("assistantProseText", () => {
  test("keeps assistant text blocks, drops thinking and tool_use", () => {
    const line = assistantLine([
      { type: "thinking", thinking: "secret reasoning here" },
      { type: "text", text: "Hello there friend." },
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const out = assistantProseText(line);
    expect(out).toContain("Hello there friend");
    expect(out).not.toContain("secret reasoning");
    expect(out).not.toContain("ls");
  });

  test("returns empty string for a user message", () => {
    const line = JSON.stringify({
      type: "user", sessionId: "s1", cwd: "/tmp", timestamp: "2026-06-01T00:00:00Z",
      message: { role: "user", content: "in a way that matters" },
    });
    expect(assistantProseText(line)).toBe("");
  });

  test("strips fenced and inline code", () => {
    const line = assistantLine([
      { type: "text", text: "Run this:\n```\nrm -rf secret\n```\nand `inlineCode` too. Done here." },
    ]);
    const out = assistantProseText(line);
    expect(out).not.toContain("rm -rf");
    expect(out).not.toContain("inlineCode");
    expect(out).toContain("Done here");
  });

  test("returns empty string for unparseable input", () => {
    expect(assistantProseText("not json")).toBe("");
  });
});

describe("sentences / tokenize", () => {
  test("splits sentences and does not join across boundaries", () => {
    expect(sentences("One two. Three four")).toEqual(["one two", "three four"]);
  });
  test("keeps apostrophe words intact and lowercases", () => {
    expect(tokenize("You're Absolutely Right")).toEqual(["you're", "absolutely", "right"]);
  });
});

describe("ngrams", () => {
  test("generates 2..5 grams within a token list", () => {
    const out = ngrams(["a", "b", "c"], 2, 5).map((g) => `${g.n}:${g.phrase}`);
    expect(out).toEqual(["2:a b", "3:a b c", "2:b c"]);
  });
});

describe("isAllStopwords", () => {
  test("all stop-words → true", () => {
    expect(isAllStopwords("in the")).toBe(true);
  });
  test("a leading/trailing stop-word with a content word → false", () => {
    expect(isAllStopwords("in a way that matters")).toBe(false);
    expect(isAllStopwords("take a look")).toBe(false);
  });
});

describe("extractPhrases", () => {
  test("no cross-sentence phrases; all-stop-word phrases dropped", () => {
    const line = assistantLine([{ type: "text", text: "matters here. Let me know." }]);
    const phrases = extractPhrases(line, { nMin: 2, nMax: 3 }).map((p) => p.phrase);
    expect(phrases).not.toContain("here let"); // would cross the sentence boundary
    expect(phrases).toContain("let me know");
    expect(phrases).not.toContain("in the"); // never present, and would be filtered anyway
  });
});
