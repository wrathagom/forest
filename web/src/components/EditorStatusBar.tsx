import { Show } from "solid-js";

export type EditorStats =
  | { kind: "markdown"; words: number; readMinutes: number }
  | { kind: "cursor"; line: number; col: number; lineCount: number };

export default function EditorStatusBar(props: {
  stats: EditorStats;
  isMarkdown: boolean;
  wrap: boolean;
  preview: boolean;
  onToggleWrap: () => void;
  onTogglePreview: () => void;
}) {
  const left = () => {
    const s = props.stats;
    if (s.kind === "markdown") {
      return `${s.words} ${s.words === 1 ? "word" : "words"} · ${s.readMinutes} min read`;
    }
    return `Ln ${s.line}, Col ${s.col} · ${s.lineCount} ${s.lineCount === 1 ? "line" : "lines"}`;
  };

  return (
    <div class="editor-status-bar">
      <span class="editor-status-left">{left()}</span>
      <span class="editor-status-right">
        <button
          class="editor-status-toggle"
          classList={{ active: props.wrap }}
          onclick={() => props.onToggleWrap()}
        >
          wrap
        </button>
        <Show when={props.isMarkdown}>
          <button
            class="editor-status-toggle"
            classList={{ active: props.preview }}
            onclick={() => props.onTogglePreview()}
          >
            preview
          </button>
        </Show>
      </span>
    </div>
  );
}
