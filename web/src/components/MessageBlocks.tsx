import { For, Show } from "solid-js";
import type { TranscriptBlock } from "../lib/transcript";
import Markdown from "./Markdown";

// Renders parsed transcript blocks: prose as markdown, tool calls and tool
// results as compact pills. Shared by the desktop transcript and the mobile
// session view; styling lives in styles.css / mobile.css under .msg-blocks.
export default function MessageBlocks(props: { blocks: TranscriptBlock[] }) {
  return (
    <div class="msg-blocks">
      <For each={props.blocks}>
        {(b) => {
          if (b.kind === "text") return <div class="msg-text"><Markdown text={b.text} /></div>;
          if (b.kind === "tool_use") {
            return (
              <div class="msg-tool">
                <span class="tool-pill">{b.name}</span>
                <Show when={b.summary}>
                  <code class="tool-summary">{b.summary}</code>
                </Show>
              </div>
            );
          }
          // tool_result
          return (
            <div class="msg-tool">
              <span class={`tool-result-pill${b.isError ? " is-error" : ""}`}>{b.isError ? "error" : "result"}</span>
              <Show when={b.preview}>
                <code class="tool-summary">{b.preview}</code>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
