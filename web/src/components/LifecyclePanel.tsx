import { Show, createResource, createSignal } from "solid-js";
import { fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle } from "../api";
import { lifecycleTone } from "../lib/dashboard-view";

export default function LifecyclePanel(props: { projectId: string }) {
  const [data, { refetch }] = createResource(() => props.projectId, fetchLifecycle);
  const [busy, setBusy] = createSignal(false);
  const [output, setOutput] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

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

  const run = async (fn: (id: string) => Promise<{ output: string; failed: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(props.projectId);
      setOutput(r.output || "(no output)");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
        {(d) => (
          <>
            <span class={`chip chip-${lifecycleTone(d().status)}`} title="forest.yaml lifecycle">{d().status}</span>

            <Show when={!d().hasConfig}>
              <span class="muted">No <code>forest.yaml</code> — add one with <code>start</code>/<code>stop</code>/<code>health</code> to enable lifecycle controls.</span>
            </Show>

            <Show when={d().hasConfig && !d().enabled}>
              <button class="lifecycle-btn" disabled={busy()} onclick={enable}>Enable lifecycle</button>
            </Show>

            <Show when={d().enabled}>
              <Show when={d().config?.start}>
                <button class="lifecycle-btn" disabled={busy()} onclick={() => run(startLifecycle)}>Start</button>
              </Show>
              <Show when={d().config?.stop}>
                <button class="lifecycle-btn" disabled={busy()} onclick={() => run(stopLifecycle)}>Stop</button>
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
          </>
        )}
      </Show>
    </div>
  );
}
