import { Show, Index, createResource, createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import { fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle, startSection, stopSection } from "../api";
import type { LifecycleStatus, LifecycleRunResult } from "../api";
import { lifecycleTone, isLifecycleUp } from "../lib/dashboard-view";

const POLL_FAST_MS = 1_000;
const POLL_SLOW_MS = 10_000;

export default function LifecyclePanel(props: { projectId: string }) {
  const [data, { refetch }] = createResource(() => props.projectId, fetchLifecycle);
  const [busy, setBusy] = createSignal(false);
  const [output, setOutput] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Optimistic status shown the instant a command is clicked, before the first
  // poll observes the server's transient state. Cleared when the command ends.
  const [pending, setPending] = createSignal<LifecycleStatus | null>(null);
  // Per-section optimistic status, keyed by section name.
  const [sectionPending, setSectionPending] = createSignal<Record<string, LifecycleStatus>>({});

  // Reset per-project local state when navigating between projects so a banner
  // or last-run output from one project can't bleed into the next.
  createEffect((prev: string | undefined) => {
    const id = props.projectId;
    if (prev !== undefined && prev !== id) {
      setError(null);
      setOutput(null);
      setPending(null);
      setSectionPending({});
    }
    return id;
  });

  // The status actually displayed: optimistic pending wins until the command
  // resolves, then the polled backend status drives the display.
  const displayStatus = (): LifecycleStatus | undefined => pending() ?? data()?.status;
  const isTransient = (s: LifecycleStatus | undefined) => s === "starting" || s === "stopping";

  // Poll the (cheap) lifecycle endpoint so status updates live without a manual
  // refresh: fast while a command is in flight or the status is transient, slow
  // otherwise. Skip entirely for a project with no forest.yaml — its lifecycle
  // status can't change through Forest. Both gates are memos so the interval is
  // recreated only when the cadence (or the should-poll gate) flips, not on
  // every poll.
  const shouldPoll = createMemo(() => busy() || !!data()?.hasConfig);
  const anySectionTransient = createMemo(() => {
    const secs = data()?.sections ?? [];
    const pend = sectionPending();
    return secs.some((s) => isTransient(pend[s.name] ?? s.status));
  });
  const fast = createMemo(() => busy() || isTransient(displayStatus()) || anySectionTransient());
  createEffect(() => {
    if (!shouldPoll()) return;
    const ms = fast() ? POLL_FAST_MS : POLL_SLOW_MS;
    const t = setInterval(() => void refetch(), ms);
    onCleanup(() => clearInterval(t));
  });

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await setLifecycleEnabled(props.projectId, true);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async (kind: "start" | "stop", fn: (id: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setPending(kind === "start" ? "starting" : "stopping");
    try {
      const r = await fn(props.projectId);
      setOutput(r.output || "(no output)");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const runSection = async (name: string, kind: "start" | "stop", fn: (id: string, section: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setSectionPending((p) => ({ ...p, [name]: kind === "start" ? "starting" : "stopping" }));
    try {
      const r = await fn(props.projectId, name);
      setOutput(r.output || "(no output)");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionPending((p) => { const { [name]: _drop, ...rest } = p; return rest; });
      setBusy(false);
    }
  };

  return (
    <div class="lifecycle-panel">
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <Show when={data.error}>
        <div class="banner banner-error">{(data.error as Error).message}</div>
      </Show>
      <Show when={data.loading && !data()}>
        <span class="muted">lifecycle…</span>
      </Show>
      <Show when={data()}>
        {(d) => {
          // Inside `Show when={data()}`, d().status === data().status, so the
          // optimistic pending value is the only thing that can override it.
          const status = () => pending() ?? d().status;
          return (
            <>
              <span class={`chip chip-${lifecycleTone(status())}`} title="forest.yaml lifecycle">{status()}</span>

              <Show when={d().config?.url && isLifecycleUp(status())}>
                <a class="lifecycle-link" href={d().config!.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
              </Show>

              <Show when={!d().hasConfig}>
                <span class="muted">No <code>forest.yaml</code> — add one with <code>start</code>/<code>stop</code>/<code>health</code> to enable lifecycle controls.</span>
              </Show>

              <Show when={d().hasConfig && !d().enabled}>
                <button class="lifecycle-btn" disabled={busy()} onclick={enable}>Enable lifecycle</button>
              </Show>

              <Show when={d().enabled}>
                <Show when={d().config?.start}>
                  <button class="lifecycle-btn" disabled={busy()} onclick={() => run("start", startLifecycle)}>Start</button>
                </Show>
                <Show when={d().config?.stop}>
                  <button class="lifecycle-btn" disabled={busy()} onclick={() => run("stop", stopLifecycle)}>Stop</button>
                </Show>
              </Show>

              <Show when={output() ?? d().lastRun?.output}>
                {(out) => (
                  <details open={d().lastRun?.failed ?? false} class="lifecycle-output">
                    <summary>last run</summary>
                    <pre>{out()}</pre>
                  </details>
                )}
              </Show>

              <Show when={d().enabled && d().sections && d().sections!.length > 0}>
                <div class="lifecycle-sections">
                  <Index each={d().sections!}>
                    {(sec) => {
                      const secStatus = (): LifecycleStatus => sectionPending()[sec().name] ?? sec().status;
                      const up = () => sec().config.health ? isLifecycleUp(secStatus()) : true;
                      return (
                        <div class="lifecycle-section">
                          <span class="lifecycle-section-name">{sec().name}</span>
                          <Show when={secStatus() !== "none"}>
                            <span class={`chip chip-${lifecycleTone(secStatus())}`} title={`${sec().name} lifecycle`}>{secStatus()}</span>
                          </Show>
                          <Show when={sec().config.url && up()}>
                            <a class="lifecycle-link" href={sec().config.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
                          </Show>
                          <Show when={sec().config.start}>
                            <button class="lifecycle-btn" disabled={busy()} aria-label={`Start ${sec().name}`} onclick={() => runSection(sec().name, "start", startSection)}>Start</button>
                          </Show>
                          <Show when={sec().config.stop}>
                            <button class="lifecycle-btn" disabled={busy()} aria-label={`Stop ${sec().name}`} onclick={() => runSection(sec().name, "stop", stopSection)}>Stop</button>
                          </Show>
                          <Show when={sec().lastRun?.output}>
                            {(out) => (
                              <details open={sec().lastRun?.failed ?? false} class="lifecycle-output">
                                <summary>last run</summary>
                                <pre>{out()}</pre>
                              </details>
                            )}
                          </Show>
                        </div>
                      );
                    }}
                  </Index>
                </div>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
