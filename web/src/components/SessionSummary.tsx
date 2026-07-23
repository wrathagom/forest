import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { getSessionSummary, requestSessionSummary, type SessionSummaryStatus } from "../api";

export const POLL_MS = 2000;
export const MAX_POLLS = 60; // ~2 minutes

export default function SessionSummary(props: {
  sessionId: string;
  title: string | null;
  /** Live, working sessions are a moving target — summarize them only on request. */
  isLive: boolean;
  onJump: (uuid: string) => void;
}) {
  const [state, setState] = createSignal<SessionSummaryStatus>({ status: "pending" });
  const [busy, setBusy] = createSignal(false);
  const [gaveUp, setGaveUp] = createSignal(false);
  // The poll loop lives in one effect. Anything that puts the server back to
  // work (a user-initiated generate, a session change) bumps this so the effect
  // tears the old loop down and starts a fresh one — a write from an async
  // continuation cannot otherwise revive a loop that has already stopped.
  const [runId, setRunId] = createSignal(0);

  // One auto-generate per session per mount, tracked outside the effect so a
  // loop restart cannot re-fire it.
  let autoRequestedFor: string | null = null;
  let lastSessionId: string | undefined;

  async function generate(force: boolean): Promise<void> {
    if (busy()) return;
    setBusy(true);
    // asking again supersedes any earlier "we stopped waiting"
    setGaveUp(false);
    try {
      const next = await requestSessionSummary(props.sessionId, force);
      setState(next);
      // The server is (or should be) working — hand back to the poll loop.
      if (next.status === "pending" || next.status === "absent") setRunId((n) => n + 1);
    } catch (err) {
      setState({ status: "error", error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  createEffect(() => {
    const sessionId = props.sessionId;
    const isLive = props.isLive;
    runId(); // restarting the loop is a tracked dependency, not a side effect

    if (lastSessionId !== undefined && lastSessionId !== sessionId) {
      // Never show the previous session's summary while the new one loads.
      setState({ status: "pending" });
      autoRequestedFor = null;
    }
    lastSessionId = sessionId;
    setGaveUp(false);

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

      // "absent" on a historical session means nobody has asked yet — ask once,
      // then keep polling for the row the request should produce.
      const wantsSummary = next.status === "absent" && !isLive;
      if (wantsSummary && autoRequestedFor !== sessionId) {
        autoRequestedFor = sessionId;
        void generate(false);
      }

      if (next.status !== "pending" && !wantsSummary) return;
      if (polls < MAX_POLLS) {
        polls++;
        timer = setTimeout(tick, POLL_MS);
      } else {
        setGaveUp(true);
      }
    };

    void tick();
    onCleanup(() => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    });
  });

  const s = () => state();
  const status = () => s().status;
  const showPending = () =>
    !gaveUp() && (status() === "pending" || (status() === "absent" && !props.isLive));

  return (
    <Show when={props.title || status() !== "skipped"}>
      <section class="session-summary">
        <Show when={props.title}>
          <h3 class="session-summary-title">{props.title}</h3>
        </Show>

        <Show when={status() !== "skipped"}>
          <div class="session-summary-body" role="status">
            <Show when={showPending()}>
              <div class="session-summary-pending muted">summarizing…</div>
            </Show>

            <Show when={!gaveUp() && status() === "absent" && props.isLive}>
              <button
                class="session-summary-action"
                disabled={busy()}
                onclick={() => void generate(false)}
              >
                {busy() ? "summarizing…" : "Summarize"}
              </button>
            </Show>

            <Show when={gaveUp()}>
              <div class="session-summary-error">
                <span>stopped waiting for the summary — it may still be running</span>
                <button
                  class="session-summary-action"
                  disabled={busy()}
                  onclick={() => void generate(true)}
                >
                  {busy() ? "retrying…" : "Retry"}
                </button>
              </div>
            </Show>

            <Show when={!gaveUp() && status() === "error"}>
              <div class="session-summary-error">
                <span>summary failed: {s().error || "unknown error"}</span>
                <button
                  class="session-summary-action"
                  disabled={busy()}
                  onclick={() => void generate(true)}
                >
                  {busy() ? "retrying…" : "Retry"}
                </button>
              </div>
            </Show>

            <Show when={status() === "ready"}>
              <Show when={s().stale}>
                <div class="session-summary-stale">
                  <span class="muted">this session continued after the summary was made</span>
                  <button
                    class="session-summary-action"
                    disabled={busy()}
                    onclick={() => void generate(true)}
                  >
                    {busy() ? "regenerating…" : "Regenerate"}
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
          </div>
        </Show>
      </section>
    </Show>
  );
}
