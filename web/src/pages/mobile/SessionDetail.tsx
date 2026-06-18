import { createSignal, createMemo, createEffect, Show, For, onCleanup } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { getAgentSessionDetail, replyToSession, markSessionDone, type AgentSessionDetail } from "../../api";
import MessageBlocks from "../../components/MessageBlocks";
import { parseMessageContent, isMechanicalMessage } from "../../lib/transcript";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const roleLabel = (role: string) => (role === "user" ? "you" : role === "assistant" ? "claude" : role);

export default function SessionDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const sid = () => params.sid!;
  const [detail, setDetail] = createSignal<AgentSessionDetail | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [doneBusy, setDoneBusy] = createSignal(false);
  const [sendError, setSendError] = createSignal<string | null>(null);

  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    try {
      const d = await getAgentSessionDetail(sid());
      if (mine === seq) { setDetail(d); setLoadError(null); }
    } catch (err) {
      if (mine === seq && detail() === null) setLoadError(err instanceof Error ? err.message : String(err));
    }
  };
  void load();
  const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
  onCleanup(() => clearInterval(t));

  // Full transcript, oldest-first, minus the mechanical tool-result-only turns.
  const turns = createMemo(() => {
    const d = detail();
    if (!d) return [] as Array<{ id: number; role: string; blocks: ReturnType<typeof parseMessageContent> }>;
    return d.messages
      .map((m) => ({ id: m.id, role: m.role, blocks: parseMessageContent(m.content) }))
      .filter((m) => m.blocks.length > 0 && !isMechanicalMessage(m.blocks));
  });
  const tokens = createMemo(() => {
    const d = detail(); if (!d) return 0;
    return d.messages.reduce((n, m) => n + (m.input_tokens ?? 0) + (m.output_tokens ?? 0) + (m.cache_create_tokens ?? 0) + (m.cache_read_tokens ?? 0), 0);
  });

  // On first load, jump to the latest message so a "waiting on me" session
  // opens at the reply, not the top of the history. Only once — later polls
  // shouldn't yank the page while you're reading.
  let lastBubble: HTMLDivElement | undefined;
  let scrolledToEnd = false;
  createEffect(() => {
    if (!scrolledToEnd && detail() && turns().length > 0) {
      scrolledToEnd = true;
      requestAnimationFrame(() => lastBubble?.scrollIntoView?.({ block: "start" }));
    }
  });

  const send = async (e: Event) => {
    e.preventDefault();
    if (!text().trim() || busy()) return;
    setBusy(true); setSendError(null);
    try { await replyToSession(sid(), text().trim()); navigate("/m"); }
    catch (err) { setSendError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const markDone = async () => {
    if (doneBusy()) return;
    setDoneBusy(true); setSendError(null);
    try { await markSessionDone(sid()); navigate("/m"); }
    catch (err) { setSendError(err instanceof Error ? err.message : String(err)); }
    finally { setDoneBusy(false); }
  };

  return (
    <Show when={detail()} fallback={<div class="m-empty">{loadError() ? `failed: ${loadError()}` : "loading…"}</div>}>
      <Show when={sendError()}><div class="m-error">{sendError()}</div></Show>
      <div class="m-transcript">
        <For each={turns()}>
          {(turn) => (
            <div class={`m-bubble m-bubble-${turn.role === "user" ? "user" : "claude"}`} ref={(el) => (lastBubble = el)}>
              <div class="m-bubble-role">{roleLabel(turn.role)}</div>
              <MessageBlocks blocks={turn.blocks} />
            </div>
          )}
        </For>
      </div>
      <div class="m-tools">{detail()!.toolCalls.length} tool calls · {fmtTokens(tokens())} tokens</div>
      <form onsubmit={send}>
        <textarea class="m-textarea" placeholder="Reply…" value={text()} oninput={(e) => setText(e.currentTarget.value)} />
        <button type="submit" class="m-btn" disabled={busy() || !text().trim()}>{busy() ? "Sending…" : "Send →"}</button>
      </form>
      <Show when={detail()!.session.project_id}>
        <button type="button" class="m-btn m-btn-secondary" onclick={() => navigate(`/projects/${encodeURIComponent(detail()!.session.project_id!)}`)}>Open full ▸</button>
      </Show>
      <button type="button" class="m-btn m-btn-secondary" disabled={doneBusy()} onclick={markDone}>{doneBusy() ? "…" : "Done — clear from list"}</button>
      <div class="m-hint">Sends as a resumed turn — picks up on your laptop via "Resume" in the sessions panel. "Done" just removes it from your mobile list.</div>
    </Show>
  );
}
