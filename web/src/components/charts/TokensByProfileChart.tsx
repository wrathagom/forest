import { For, Show, createMemo } from "solid-js";
import type { TokensByProfileRow } from "../../api";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokensByProfileChart(props: {
  data: TokensByProfileRow[];
  onSelectProfile?: (profile: string) => void;
  series?: { input: boolean; output: boolean; cache: boolean };
}) {
  const view = createMemo(() => {
    const s = props.series ?? { input: true, output: true, cache: true };
    const visTotal = (r: TokensByProfileRow) => (s.input ? r.input : 0) + (s.output ? r.output : 0) + (s.cache ? r.cache : 0);
    const max = Math.max(1, ...props.data.map(visTotal));
    return props.data.map((r) => {
      const total = visTotal(r);
      const iv = s.input ? r.input : 0;
      const ov = s.output ? r.output : 0;
      const cv = s.cache ? r.cache : 0;
      return {
        r,
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
              class={`tbp-row ${props.onSelectProfile ? "tbp-clickable" : ""}`}
              title={`${v.r.profile}\n${v.r.sessions} session${v.r.sessions === 1 ? "" : "s"}\ninput ${fmt(v.r.input)} · output ${fmt(v.r.output)} · cache ${fmt(v.r.cache)}`}
              onclick={() => props.onSelectProfile?.(v.r.profile)}
            >
              <span class="tbp-label">{v.r.profile}</span>
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
