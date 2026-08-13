import { For, Show, createMemo } from "solid-js";
import type { TokenBucket, TokensOverTimePoint } from "../../api";

const W = 720;
const H = 180;
const M = { top: 10, right: 8, bottom: 22, left: 44 };

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type Segment = { y: number; h: number; cls?: string; color?: string };
type Bar = { x: number; title: string; segments: Segment[] };

export default function TokensOverTimeChart(props: {
  data: TokensOverTimePoint[];
  series?: { input: boolean; output: boolean; cache: boolean };
  mode?: "type" | "profile";
  profiles?: string[];
  colors?: Record<string, string>;
}) {
  const view = createMemo(() => {
    const data = props.data;
    const mode = props.mode ?? "type";
    const s = props.series ?? { input: true, output: true, cache: true };
    // `profiles` is the *visible* account list. Without one there is no account
    // filter in play, so the flat all-accounts totals are the honest source.
    const profiles = props.profiles;
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const slot = plotW / Math.max(1, data.length);
    const barW = Math.max(1, slot * 0.7);
    const baseY = M.top + plotH;

    const ZERO = { input: 0, output: 0, cache: 0 };
    const visible = (b: TokenBucket) => (s.input ? b.input : 0) + (s.output ? b.output : 0) + (s.cache ? b.cache : 0);
    // Each day's totals with the account filter applied but the type split kept,
    // so the type segments below can still be drawn from it.
    const typed = (d: TokensOverTimePoint): TokenBucket =>
      profiles
        ? profiles.reduce((acc, p) => {
            const b = d.byProfile[p] ?? ZERO;
            return { input: acc.input + b.input, output: acc.output + b.output, cache: acc.cache + b.cache };
          }, { ...ZERO })
        : d;

    let max = 1;
    let bars: Bar[] = [];

    if (mode === "profile") {
      const list = profiles ?? [];
      const colors = props.colors ?? {};
      max = Math.max(1, ...data.map((d) => list.reduce((sum, p) => sum + visible(d.byProfile[p] ?? ZERO), 0)));
      bars = data.map((d, i) => {
        const x = M.left + i * slot + (slot - barW) / 2;
        let acc = 0;
        const segments: Segment[] = [];
        for (const p of list) {
          const val = visible(d.byProfile[p] ?? ZERO);
          const h = (val / max) * plotH;
          // Applied below as an inline `fill` style property, not an SVG
          // presentation attribute, so var() resolves.
          segments.push({ y: baseY - acc - h, h, color: colors[p] ?? "var(--fg-faint)" });
          acc += h;
        }
        const title = `${d.day}\n` + list
          .filter((p) => visible(d.byProfile[p] ?? ZERO) > 0)
          .map((p) => `${p} ${fmt(visible(d.byProfile[p] ?? ZERO))}`)
          .join(" · ");
        return { x, title, segments };
      });
    } else {
      max = Math.max(1, ...data.map((d) => visible(typed(d))));
      bars = data.map((d, i) => {
        const x = M.left + i * slot + (slot - barW) / 2;
        const t = typed(d);
        const hIn = ((s.input ? t.input : 0) / max) * plotH;
        const hOut = ((s.output ? t.output : 0) / max) * plotH;
        const hCache = ((s.cache ? t.cache : 0) / max) * plotH;
        return {
          x,
          title: `${d.day}\ninput ${fmt(t.input)} · output ${fmt(t.output)} · cache ${fmt(t.cache)}`,
          segments: [
            { cls: "tok-in", y: baseY - hIn, h: hIn },
            { cls: "tok-out", y: baseY - hIn - hOut, h: hOut },
            { cls: "tok-cache", y: baseY - hIn - hOut - hCache, h: hCache },
          ],
        };
      });
    }

    const xLabels = data.length
      ? [0, Math.floor(data.length / 2), data.length - 1].map((i) => ({
          x: M.left + i * slot + slot / 2,
          text: data[i]!.day.slice(5), // MM-DD
        }))
      : [];
    return { bars, barW, max, xLabels, baseY };
  });

  return (
    <Show when={props.data.length > 0} fallback={<div class="chart-empty muted">no data yet</div>}>
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="tokens over time">
        <line x1={M.left} y1={view().baseY} x2={W - M.right} y2={view().baseY} class="chart-axis" />
        <line x1={M.left} y1={M.top} x2={W - M.right} y2={M.top} class="chart-grid" />
        <text x={M.left - 6} y={M.top + 4} class="chart-tick" text-anchor="end">{fmt(view().max)}</text>
        <text x={M.left - 6} y={view().baseY} class="chart-tick" text-anchor="end">0</text>
        <For each={view().bars}>
          {(b) => (
            <g class="totc-bar">
              <title>{b.title}</title>
              <For each={b.segments}>
                {(s) => (
                  <Show when={s.h > 0.5}>
                    <rect x={b.x} y={s.y} width={view().barW} height={s.h} class={s.cls} style={s.color ? { fill: s.color } : undefined} />
                  </Show>
                )}
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
