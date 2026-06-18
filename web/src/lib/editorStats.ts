import type { EditorState } from "@codemirror/state";

export type MarkdownStats = { words: number; readMinutes: number };
export type CursorStats = { line: number; col: number; lineCount: number };

const WORDS_PER_MINUTE = 200;

export function markdownStats(text: string): MarkdownStats {
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  const readMinutes = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, readMinutes };
}

export function cursorStats(state: EditorState): CursorStats {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return {
    line: line.number,
    col: head - line.from + 1,
    lineCount: state.doc.lines,
  };
}
