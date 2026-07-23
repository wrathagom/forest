import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { getSessionSummary, requestSessionSummary, type SessionSummaryStatus } from "../api";

const POLL_MS = 2000;
const MAX_POLLS = 60; // ~2 minutes

export default function SessionSummary(props: {
  sessionId: string;
  title: string | null;
  /** Live, working sessions are a moving target — summarize them only on request. */
  isLive: boolean;
  onJump: (uuid: string) => void;
}) {
  const [state, setState] = createSignal<SessionSummaryStatus>({ status: "pending" });
  const [busy, setBusy] = createSignal(false);

  async function generate(force: boolean): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      setState(await requestSessionSummary(props.sessionId, force));
    } catch (err) {
      setState({ status: "error", error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  createEffect(() => {
    const sessionId = props.sessionId;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      let next: SessionSummaryStatus;
      try {
        next = await getSessionSummary(sessionId);
      } catch (err) {
        if (!cancelled) setState({ status: "error", error: (err as Error).message });
        return;
      }
      if (cancelled) return;
      setState(next);

      if (next.status === "absent" && !props.isLive && polls === 0) {
        void generate(false);
        polls++;
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      if (next.status === "pending" && polls < MAX_POLLS) {
        polls++;
        timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    onCleanup(() => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    });
  });

  const s = () => state();

  return (
    <Show when={s().status !== "skipped"}>
      <section class="session-summary">
        <Show when={props.title}>
          <h3 class="session-summary-title">{props.title}</h3>
        </Show>

        <Show when={s().status === "pending" || (s().status === "absent" && !props.isLive)}>
          <div class="session-summary-pending muted">summarizing…</div>
        </Show>

        <Show when={s().status === "absent" && props.isLive}>
          <button class="session-summary-action" onclick={() => void generate(false)}>
            Summarize
          </button>
        </Show>

        <Show when={s().status === "error"}>
          <div class="session-summary-error">
            <span class="muted">summary failed: {s().error}</span>
            <button class="session-summary-action" onclick={() => void generate(true)}>Retry</button>
          </div>
        </Show>

        <Show when={s().status === "ready"}>
          <Show when={s().stale}>
            <div class="session-summary-stale">
              <span class="muted">this session continued after the summary was made</span>
              <button class="session-summary-action" onclick={() => void generate(true)}>
                Regenerate
              </button>
            </div>
          </Show>
          <p class="session-summary-text">{s().summary}</p>
          <Show when={(s().moments ?? []).length > 0}>
            <ul class="session-summary-moments">
              <For each={s().moments}>
                {(m) => (
                  <li>
                    <button class="session-moment" onclick={() => props.onJump(m.uuid)}>
                      {m.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>
    </Show>
  );
}
