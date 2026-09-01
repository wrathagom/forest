import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchPhrases,
  fetchPhraseOccurrences,
  fetchPhraseStatus,
  rebuildPhrases,
  type PhraseRow,
  type PhraseOccurrence,
} from "../api";
import RelativeTime from "./RelativeTime";

function Sparkline(props: { monthly: { month: string; count: number }[] }) {
  const max = () => Math.max(1, ...props.monthly.map((m) => m.count));
  const pts = () => {
    const m = props.monthly;
    if (m.length <= 1) return "";
    return m
      .map((d, i) => `${(i / (m.length - 1)) * 60},${20 - (d.count / max()) * 18}`)
      .join(" ");
  };
  return (
    <svg width="60" height="20" class="phrase-spark" aria-hidden="true">
      <polyline points={pts()} fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}

export default function PhrasesTab() {
  const nav = useNavigate();
  const [n, setN] = createSignal(3);
  const [sort, setSort] = createSignal<"count" | "trending">("count");
  const [expanded, setExpanded] = createSignal<string | null>(null);

  const [status, { refetch: refetchStatus }] = createResource(fetchPhraseStatus);
  const [board] = createResource(
    () => ({ n: n(), sort: sort() }),
    (key) => fetchPhrases({ n: key.n, sort: key.sort, limit: 100 }),
  );

  const [occurrences] = createResource(expanded, (phrase) =>
    phrase ? fetchPhraseOccurrences(phrase) : Promise.resolve({ occurrences: [] as PhraseOccurrence[] }),
  );

  // While a rebuild is running, poll status so the UI flips back to "done"
  // without a manual reload (the rebuild POST is fire-and-forget).
  createEffect(() => {
    if (!status()?.building) return;
    const id = setInterval(() => void refetchStatus(), 2000);
    onCleanup(() => clearInterval(id));
  });

  const doRebuild = async () => {
    await rebuildPhrases();
    void refetchStatus();
  };

  const toggle = (phrase: string) => setExpanded((cur) => (cur === phrase ? null : phrase));

  return (
    <div class="phrases-tab">
      <div class="phrases-controls">
        <label>
          words
          <select value={n()} onchange={(e) => setN(parseInt(e.currentTarget.value, 10))}>
            <For each={[2, 3, 4, 5]}>{(v) => <option value={v}>{v}</option>}</For>
          </select>
        </label>
        <div class="phrases-sort">
          <button type="button" classList={{ active: sort() === "count" }} onclick={() => setSort("count")}>most used</button>
          <button type="button" classList={{ active: sort() === "trending" }} onclick={() => setSort("trending")}>trending</button>
        </div>
        <span class="phrases-status muted">
          <Show when={status()}>
            {(s) => (
              <Show when={s().lastBuiltAt !== null} fallback={<>index not built</>}>
                built <RelativeTime ms={s().lastBuiltAt} /> · {s().rowCount} phrases
                <Show when={s().staleNewMsgs > 0}> · {s().staleNewMsgs} new</Show>
              </Show>
            )}
          </Show>
          <button type="button" class="phrases-rebuild" onclick={doRebuild} disabled={status()?.building}>
            {status()?.building ? "building…" : "rebuild"}
          </button>
        </span>
      </div>

      <Show when={board()} fallback={<div class="muted sessions-empty">loading phrases…</div>}>
        <Show when={(board()?.phrases.length ?? 0) > 0} fallback={<div class="muted sessions-empty">no phrases yet — try rebuilding the index</div>}>
          <table class="sessions-table phrases-table">
            <thead>
              <tr><th>phrase</th><th>count</th><th>trend</th></tr>
            </thead>
            <tbody>
              <For each={board()!.phrases}>
                {(row: PhraseRow) => (
                  <>
                    <tr class="clickable" onclick={() => toggle(row.phrase)}>
                      <td>{row.phrase}</td>
                      <td class="muted">{row.count}</td>
                      <td class="muted"><Sparkline monthly={row.monthly} /></td>
                    </tr>
                    <Show when={expanded() === row.phrase}>
                      <tr class="phrase-occurrences">
                        <td colspan="3">
                          <Show when={!occurrences.loading && occurrences()} fallback={<span class="muted">loading occurrences…</span>}>
                            <For each={occurrences()!.occurrences} fallback={<span class="muted">no occurrences found</span>}>
                              {(o: PhraseOccurrence) => (
                                <div
                                  class="phrase-occurrence"
                                  classList={{ clickable: !!o.project_id }}
                                  onclick={() => {
                                    if (o.project_id) nav(`/projects/${encodeURIComponent(o.project_id)}?session=${encodeURIComponent(o.session_id)}`);
                                  }}
                                >
                                  <RelativeTime ms={o.timestamp} />
                                  <span class="phrase-snippet" innerHTML={o.snippet} />
                                </div>
                              )}
                            </For>
                          </Show>
                        </td>
                      </tr>
                    </Show>
                  </>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}
