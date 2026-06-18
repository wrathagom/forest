import { test, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownStats, cursorStats } from "../src/lib/editorStats";

test("markdownStats counts whitespace-separated words", () => {
  expect(markdownStats("hello there world")).toEqual({ words: 3, readMinutes: 1 });
});

test("markdownStats treats empty/whitespace text as zero", () => {
  expect(markdownStats("")).toEqual({ words: 0, readMinutes: 0 });
  expect(markdownStats("   \n  ")).toEqual({ words: 0, readMinutes: 0 });
});

test("markdownStats reading time is words/200 rounded, min 1", () => {
  expect(markdownStats("w ".repeat(100).trim()).readMinutes).toBe(1); // 100 -> round(0.5)=1, max(1,..)=1
  expect(markdownStats("w ".repeat(450).trim()).readMinutes).toBe(2); // 450/200=2.25 -> 2
  expect(markdownStats("w ".repeat(20).trim()).readMinutes).toBe(1);  // round(0.1)=0 -> max(1,0)=1
});

test("cursorStats reports 1-based line/col and total line count", () => {
  const state = EditorState.create({
    doc: "first line\nsecond line\nthird",
    selection: { anchor: 17 }, // index 17 is in line 2, 6 chars in -> col 7 (1-based)
  });
  expect(cursorStats(state)).toEqual({ line: 2, col: 7, lineCount: 3 });
});

test("cursorStats at document start", () => {
  const state = EditorState.create({ doc: "", selection: { anchor: 0 } });
  expect(cursorStats(state)).toEqual({ line: 1, col: 1, lineCount: 1 });
});
