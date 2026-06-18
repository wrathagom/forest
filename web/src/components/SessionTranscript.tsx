import { For, Show, createResource, createMemo, createSignal } from "solid-js";
import { getAgentSessionDetail, type AgentSessionDetail } from "../api";
import MessageBlocks from "./MessageBlocks";
import { parseMessageContent } from "../lib/transcript";

export type ResumeKind = "default" | "in-main" | "recreate-worktree";

export default function SessionTranscript(props: {
  sessionId: string;
  onResume: (kind: ResumeKind, detail: AgentSessionDetail) => void;
}) {
  const [data] = createResource(() => props.sessionId, getAgentSessionDetail);

  const [resumeOpen, setResumeOpen] = createSignal(false);

  const totals = createMemo(() => {
    const d = data();
    if (!d) return { tokens: 0, toolCalls: 0, models: [] as string[] };
    const tokens = d.messages.reduce(
      (acc, m) => acc + (m.input_tokens ?? 0) + (m.output_tokens ?? 0),
      0,
    );
    const models = Array.from(new Set(d.messages.map((m) => m.model).filter((m): m is string => !!m)));
    return { tokens, toolCalls: d.toolCalls.length, models };
  });

  // Drop messages that parse to zero displayable blocks (housekeeping lines like
  // permission-mode / file-history-snapshot, or summary/compact records).
  const visibleMessages = createMemo(() => {
    const d = data();
    if (!d) return [];
    return d.messages
      .map((m) => ({ msg: m, blocks: parseMessageContent(m.content) }))
      .filter(({ blocks }) => blocks.length > 0);
  });

  return (
    <Show when={data()} fallback={<div class="muted" style={{ padding: "1rem" }}>loading transcript…</div>}>
      {(d) => (
        <div class="session-transcript">
          <header class="session-transcript-head">
            <For each={totals().models}>
              {(m) => <span class="model-badge">{m}</span>}
            </For>
            <span class="muted">{totals().tokens} tokens</span>
            <span class="muted">{totals().toolCalls} tool calls</span>
            <Show
              when={d().session.cwd_exists === 1}
              fallback={
                <>
                  <button onclick={() => setResumeOpen(true)}>Resume (worktree gone)</button>
                  <Show when={resumeOpen()}>
                    <div class="resume-modal">
                      <button onclick={() => { setResumeOpen(false); props.onResume("in-main", d()); }}>
                        Resume in main
                      </button>
                      <Show when={d().session.branch}>
                        <button
                          onclick={() => { setResumeOpen(false); props.onResume("recreate-worktree", d()); }}
                        >
                          Recreate worktree from {d().session.branch}
                        </button>
                      </Show>
                      <button onclick={() => setResumeOpen(false)}>Cancel</button>
                    </div>
                  </Show>
                </>
              }
            >
              <button onclick={() => props.onResume("default", d())}>Resume</button>
            </Show>
          </header>
          <ol class="session-transcript-body">
            <For each={visibleMessages()}>
              {({ msg, blocks }) => (
                <li class={`msg msg-${msg.role}`}>
                  <span class="muted msg-role">{msg.role}</span>
                  <MessageBlocks blocks={blocks} />
                </li>
              )}
            </For>
          </ol>
        </div>
      )}
    </Show>
  );
}
