import { createStore, reconcile } from "solid-js/store";
import { createSignal, createEffect, onCleanup, untrack, Show, type JSX } from "solid-js";

export default function PanelShell<T extends Record<string, unknown>>(props: {
  title: string;
  fetcher: () => Promise<T[]>;
  pollMs: number;
  enabled: () => boolean;
  keyField: keyof T;
  children: (rows: T[]) => JSX.Element;
  emptyMessage?: string;
}) {
  type State = { rows: T[]; loaded: boolean; error: Error | null };
  const [state, setState] = createStore<State>({ rows: [], loaded: false, error: null });
  const [loading, setLoading] = createSignal(false);

  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (!props.enabled() || loading()) return;
    setLoading(true);
    try {
      const fresh = await props.fetcher();
      setState("error", null);
      setState("rows", reconcile(fresh, { key: props.keyField as string, merge: true }));
      setState("loaded", true);
    } catch (err) {
      setState("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (props.enabled()) {
      untrack(() => void tick());
      if (props.pollMs > 0) {
        timer = setInterval(() => void tick(), props.pollMs);
      }
    }
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const retry = () => void tick();

  return (
    <div class="panel-shell">
      <header class="panel-shell-head">
        <span class="panel-shell-title">{props.title}</span>
      </header>
      <div class="panel-shell-body">
        <Show when={state.error}>
          <div class="banner banner-error">
            {(state.error as Error)?.message ?? "fetch failed"}
            <button class="panel-retry" onclick={retry}>retry</button>
          </div>
        </Show>
        <Show when={!state.loaded && loading()}>
          <div class="muted">loading…</div>
        </Show>
        <Show when={state.loaded && state.rows.length === 0}>
          <div class="muted">{props.emptyMessage ?? "nothing to show"}</div>
        </Show>
        <Show when={state.rows.length > 0}>
          {props.children(state.rows)}
        </Show>
      </div>
    </div>
  );
}
