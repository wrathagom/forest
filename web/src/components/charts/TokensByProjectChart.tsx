import { For, Show, createMemo } from "solid-js";
import type { TokenBucket, TokensByProjectRow } from "../../api";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokensByProjectChart(props: {
  data: TokensByProjectRow[];
  onSelectProject?: (projectId: string | null) => void;
  series?: { input: boolean; output: boolean; cache: boolean };
  profiles?: string[];
}) {
  const view = createMemo(() => {
    const s = props.series ?? { input: true, output: true, cache: true };
    // `profiles` is the visible account list; without one, no account filter is
    // in play and the flat all-accounts totals are the honest source.
    const profiles = props.profiles;
    const ZERO = { input: 0, output: 0, cache: 0 };
    const typed = (r: TokensByProjectRow): TokenBucket =>
      profiles
        ? profiles.reduce((acc, p) => {
            const b = r.byProfile[p] ?? ZERO;
            return { input: acc.input + b.input, output: acc.output + b.output, cache: acc.cache + b.cache };
          }, { ...ZERO })
        : r;
    const visTotal = (b: TokenBucket) => (s.input ? b.input : 0) + (s.output ? b.output : 0) + (s.cache ? b.cache : 0);
    const max = Math.max(1, ...props.data.map((r) => visTotal(typed(r))));
    return props.data.map((r) => {
      const t = typed(r);
      const total = visTotal(t);
      const iv = s.input ? t.input : 0;
      const ov = s.output ? t.output : 0;
      const cv = s.cache ? t.cache : 0;
      return {
        r,
        t,
        total,
        widthPct: (total / max) * 100,
        inPct: total ? (iv / total) * 100 : 0,
        outPct: total ? (ov / total) * 100 : 0,
        cachePct: total ? (cv / total) * 100 : 0,
      };
    });
  });

  return (
    <Show when={props.data.length > 0} fallback={<div class="chart-empty muted">no data yet</div>}>
      <div class="tbp">
        <For each={view()}>
          {(v) => (
            <div
              class={`tbp-row ${props.onSelectProject ? "tbp-clickable" : ""}`}
              title={`${v.r.projectName}\n${v.r.sessions} session${v.r.sessions === 1 ? "" : "s"}\ninput ${fmt(v.t.input)} · output ${fmt(v.t.output)} · cache ${fmt(v.t.cache)}`}
              onclick={() => props.onSelectProject?.(v.r.projectId)}
            >
              <span class="tbp-label">{v.r.projectName}</span>
              <span class="tbp-track">
                <span class="tbp-bar" style={{ width: `${v.widthPct}%` }}>
                  <span class="tok-in" style={{ width: `${v.inPct}%` }} />
                  <span class="tok-out" style={{ width: `${v.outPct}%` }} />
                  <span class="tok-cache" style={{ width: `${v.cachePct}%` }} />
                </span>
              </span>
              <span class="tbp-total muted">{fmt(v.total)}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
