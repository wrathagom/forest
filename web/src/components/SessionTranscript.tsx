import { For, Show, createResource, createMemo, createSignal, onCleanup } from "solid-js";
import { getAgentSessionDetail, type AgentSessionDetail } from "../api";
import MessageBlocks from "./MessageBlocks";
import SessionSummary from "./SessionSummary";
import { parseMessageContent } from "../lib/transcript";

export type ResumeKind = "default" | "in-main" | "recreate-worktree";

/** Must stay in step with the msg-flash animation duration in styles.css. */
const FLASH_MS = 1200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function SessionTranscript(props: {
  sessionId: string;
  onResume: (kind: ResumeKind, detail: AgentSessionDetail) => void;
}) {
  const [data] = createResource(() => props.sessionId, getAgentSessionDetail);

  const [resumeOpen, setResumeOpen] = createSignal(false);

  let bodyRef: HTMLOListElement | undefined;
  let flashEl: HTMLElement | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  // The digest only ever includes messages that render, so a miss here means the
  // message was filtered out after the summary was made — do nothing rather than
  // scroll somewhere arbitrary.
  function jumpTo(uuid: string): void {
    // uuids are hex + dashes, so a plain attribute selector is safe here — and
    // CSS.escape is not guaranteed present under jsdom in the test environment.
    if (!/^[A-Za-z0-9-]+$/.test(uuid)) return;
    const el = bodyRef?.querySelector<HTMLElement>(`[data-msg-uuid="${uuid}"]`);
    if (!el) return;

    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });

    // Send focus to the destination as well, so keyboard and screen-reader users
    // land there too and Tab continues from the message, not from the chip.
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });

    // Re-adding a class the element already carries animates nothing, so restart
    // the flash explicitly — and give this click its own removal deadline rather
    // than letting an earlier one cut it short.
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    if (flashEl && flashEl !== el) flashEl.classList.remove("msg-flash");
    el.classList.remove("msg-flash");
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add("msg-flash");
    flashEl = el;
    flashTimer = setTimeout(() => {
      el.classList.remove("msg-flash");
      flashEl = undefined;
      flashTimer = undefined;
    }, FLASH_MS);
  }

  onCleanup(() => {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
  });

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
          <SessionSummary
            sessionId={props.sessionId}
            title={d().session.title ?? null}
            isLive={false}
            onJump={jumpTo}
          />
          <ol class="session-transcript-body" ref={bodyRef}>
            <For each={visibleMessages()}>
              {({ msg, blocks }) => (
                <li class={`msg msg-${msg.role}`} data-msg-uuid={msg.uuid ?? undefined}>
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
