import { For, Show, createMemo } from "solid-js";
import type { TokensOverTimePoint } from "../../api";

const W = 720;
const H = 180;
const M = { top: 10, right: 8, bottom: 22, left: 44 };

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokensOverTimeChart(props: { data: TokensOverTimePoint[]; series?: { input: boolean; output: boolean; cache: boolean } }) {
  const view = createMemo(() => {
    const data = props.data;
    const s = props.series ?? { input: true, output: true, cache: true };
    const totals = data.map((d) => (s.input ? d.input : 0) + (s.output ? d.output : 0) + (s.cache ? d.cache : 0));
    const max = Math.max(1, ...totals);
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const slot = plotW / Math.max(1, data.length);
    const barW = Math.max(1, slot * 0.7);
    const bars = data.map((d, i) => {
      const x = M.left + i * slot + (slot - barW) / 2;
      const hIn = ((s.input ? d.input : 0) / max) * plotH;
      const hOut = ((s.output ? d.output : 0) / max) * plotH;
      const hCache = ((s.cache ? d.cache : 0) / max) * plotH;
      const baseY = M.top + plotH;
      return {
        d,
        x,
        segments: [
          { cls: "tok-in", y: baseY - hIn, h: hIn },
          { cls: "tok-out", y: baseY - hIn - hOut, h: hOut },
          { cls: "tok-cache", y: baseY - hIn - hOut - hCache, h: hCache },
        ],
      };
    });
    const xLabels = data.length
      ? [0, Math.floor(data.length / 2), data.length - 1].map((i) => ({
          x: M.left + i * slot + slot / 2,
          text: data[i]!.day.slice(5), // MM-DD
        }))
      : [];
    return { bars, barW, max, xLabels, baseY: M.top + plotH };
  });

  return (
    <Show
      when={props.data.length > 0}
      fallback={<div class="chart-empty muted">no data yet</div>}
    >
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="tokens over time">
        {/* baseline + max gridline */}
        <line x1={M.left} y1={view().baseY} x2={W - M.right} y2={view().baseY} class="chart-axis" />
        <line x1={M.left} y1={M.top} x2={W - M.right} y2={M.top} class="chart-grid" />
        <text x={M.left - 6} y={M.top + 4} class="chart-tick" text-anchor="end">{fmt(view().max)}</text>
        <text x={M.left - 6} y={view().baseY} class="chart-tick" text-anchor="end">0</text>
        <For each={view().bars}>
          {(b) => (
            <g class="totc-bar">
              <title>{`${b.d.day}\ninput ${fmt(b.d.input)} · output ${fmt(b.d.output)} · cache ${fmt(b.d.cache)}`}</title>
              <For each={b.segments}>
                {(s) => <Show when={s.h > 0.5}><rect x={b.x} y={s.y} width={view().barW} height={s.h} class={s.cls} /></Show>}
              </For>
            </g>
          )}
        </For>
        <For each={view().xLabels}>
          {(l) => <text x={l.x} y={H - 6} class="chart-tick" text-anchor="middle">{l.text}</text>}
        </For>
      </svg>
    </Show>
  );
}
