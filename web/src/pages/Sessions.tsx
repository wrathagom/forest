import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchSessionsOverview,
  fetchSessionsStats,
  type SessionListRow,
  type SessionsSort,
} from "../api";
import RelativeTime from "../components/RelativeTime";
import TokensOverTimeChart from "../components/charts/TokensOverTimeChart";
import TokensByProjectChart from "../components/charts/TokensByProjectChart";
import TokensByProfileChart from "../components/charts/TokensByProfileChart";
import { profileColorMap } from "../components/charts/profileColors";

const PAGE = 50;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
function profileLabel(p: string | null): string {
  return p ?? "unassigned";
}

const COLUMNS: Array<{ key: SessionsSort | null; label: string }> = [
  { key: "project", label: "project" },
  { key: "profile", label: "profile" },
  { key: null, label: "session" },
  { key: null, label: "worktree" },
  { key: "started_at", label: "started" },
  { key: "last_activity", label: "activity" },
  { key: "message_count", label: "msgs" },
  { key: "tokens", label: "tokens" },
];

export default function Sessions() {
  const nav = useNavigate();
  const [query, setQuery] = createSignal("");
  const [debounced, setDebounced] = createSignal("");
  const [project, setProject] = createSignal("");          // "" all, "none" unassigned, else project id
  const [sort, setSort] = createSignal<SessionsSort>("last_activity");
  const [dir, setDir] = createSignal<"asc" | "desc">("desc");
  const [offset, setOffset] = createSignal(0);
  const [rows, setRows] = createSignal<SessionListRow[]>([]);
  const [total, setTotal] = createSignal(0);
  const [series, setSeries] = createSignal({ input: true, output: true, cache: true });
  const toggleSeries = (k: "input" | "output" | "cache") => setSeries((s) => ({ ...s, [k]: !s[k] }));
  const [profile, setProfile] = createSignal("");           // "" all, else normalized profile key
  const [chartMode, setChartMode] = createSignal<"type" | "profile">("type");

  createEffect(() => {
    const q = query();
    const t = setTimeout(() => setDebounced(q), 200);
    onCleanup(() => clearTimeout(t));
  });
  // resetting the visible window whenever the filter/sort changes
  createEffect(() => {
    debounced();
    project();
    profile();
    sort();
    dir();
    setOffset(0);
  });

  const [stats] = createResource(fetchSessionsStats);
  const [page] = createResource(
    () => ({ q: debounced(), project: project(), profile: profile(), sort: sort(), dir: dir(), offset: offset() }),
    (key) =>
      fetchSessionsOverview({
        q: key.q || undefined,
        project: key.project || undefined,
        profile: key.profile || undefined,
        sort: key.sort,
        dir: key.dir,
        limit: PAGE,
        offset: key.offset,
      }),
  );

  // Accumulate results as pages load
  createEffect(() => {
    const p = page();
    if (!p) return;
    setTotal(p.total);
    if (offset() === 0) setRows(p.sessions);
    else setRows((prev) => [...prev, ...p.sessions]);
  });

  const hasMore = () => rows().length < total();

  const onHeaderClick = (key: SessionsSort | null) => {
    if (!key) return;
    if (sort() === key) setDir(dir() === "desc" ? "asc" : "desc");
    else {
      setSort(key);
      setDir("desc");
    }
  };

  const projectOptions = createMemo(() =>
    (stats()?.tokensByProject ?? []).map((p) => ({
      value: p.projectId ?? "none",
      label: p.projectName,
    })),
  );

  const profileOptions = createMemo(() => stats()?.profiles ?? []);
  const profileColors = createMemo(() => profileColorMap(stats()?.profiles ?? []));

  const empty = () => page.state === "ready" && total() === 0 && !debounced() && project() === "" && profile() === "";

  return (
    <div class="sessions-page">
      <h2 class="section-title">sessions</h2>

      <Show when={stats()}>
        {(s) => (
          <p class="muted sessions-totals">
            {s().totals.sessions} sessions · {fmt(s().totals.input)} in · {fmt(s().totals.output)} out ·{" "}
            {fmt(s().totals.cache)} cache
          </p>
        )}
      </Show>

      <Show when={!empty()}>
        <div class="chart-toolbar">
          <div class="chart-mode-toggle">
            <button type="button" classList={{ active: chartMode() === "type" }} onclick={() => setChartMode("type")}>by type</button>
            <button type="button" classList={{ active: chartMode() === "profile" }} onclick={() => setChartMode("profile")}>by account</button>
          </div>
          <Show when={chartMode() === "type"}>
            <div class="chart-legend">
              <button type="button" class="chart-legend-item" classList={{ off: !series().input }} onclick={() => toggleSeries("input")}><i class="tok-in" /> input</button>
              <button type="button" class="chart-legend-item" classList={{ off: !series().output }} onclick={() => toggleSeries("output")}><i class="tok-out" /> output</button>
              <button type="button" class="chart-legend-item" classList={{ off: !series().cache }} onclick={() => toggleSeries("cache")}><i class="tok-cache" /> cache</button>
            </div>
          </Show>
          <Show when={chartMode() === "profile"}>
            <div class="chart-legend">
              <For each={profileOptions()}>
                {(p) => <span class="chart-legend-item"><i style={{ background: profileColors()[p] }} /> {p}</span>}
              </For>
            </div>
          </Show>
        </div>

        <section class="sessions-chart-card">
          <h3 class="section-title">tokens · last 30 days</h3>
          <TokensOverTimeChart
            data={stats()?.tokensOverTime ?? []}
            series={series()}
            mode={chartMode()}
            profiles={profileOptions()}
            colors={profileColors()}
          />
        </section>

        <div class="sessions-charts">
          <section class="sessions-chart-card">
            <h3 class="section-title">tokens by project</h3>
            <TokensByProjectChart
              data={stats()?.tokensByProject ?? []}
              series={series()}
              onSelectProject={(id) => setProject(id ?? "none")}
            />
          </section>
          <section class="sessions-chart-card">
            <h3 class="section-title">tokens by account</h3>
            <TokensByProfileChart
              data={stats()?.tokensByProfile ?? []}
              series={series()}
              onSelectProfile={(p) => setProfile(p)}
            />
          </section>
        </div>
      </Show>

      <div class="sessions-controls">
        <input
          class="sessions-search"
          placeholder="search all sessions"
          value={query()}
          oninput={(e) => setQuery(e.currentTarget.value)}
        />
        <select class="sessions-project" value={project()} onchange={(e) => setProject(e.currentTarget.value)}>
          <option value="">all projects</option>
          <For each={projectOptions()}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        </select>
        <select class="sessions-profile" value={profile()} onchange={(e) => setProfile(e.currentTarget.value)}>
          <option value="">all accounts</option>
          <For each={profileOptions()}>{(p) => <option value={p}>{p}</option>}</For>
        </select>
      </div>

      <Show when={page.error}>
        <div class="banner banner-error">failed to load sessions: {(page.error as Error)?.message ?? "unknown"}</div>
      </Show>

      <Show
        when={!empty()}
        fallback={<div class="muted sessions-empty">no agent sessions recorded yet</div>}
      >
        <Show
          when={total() > 0 || page.loading}
          fallback={<div class="muted sessions-empty">no sessions match this filter</div>}
        >
          <table class="sessions-table">
            <thead>
              <tr>
                <For each={COLUMNS}>
                  {(c) => (
                    <th
                      class={c.key ? "sortable" : ""}
                      classList={{ "sort-active": c.key !== null && sort() === c.key }}
                      onclick={() => onHeaderClick(c.key)}
                    >
                      {c.label}
                      <Show when={c.key !== null && sort() === c.key}>
                        <span class="sort-arrow">{dir() === "desc" ? "▾" : "▴"}</span>
                      </Show>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(s) => (
                  <tr
                    classList={{ clickable: !!s.project_id }}
                    title={s.cwd}
                    onclick={() => {
                      if (s.project_id) nav(`/projects/${encodeURIComponent(s.project_id)}?session=${encodeURIComponent(s.session_id)}`);
                    }}
                  >
                    <td class="muted">{s.project_name ?? "—"}</td>
                    <td class="muted">{profileLabel(s.profile)}</td>
                    <td class="sessions-summary">
                      <span class={`sessions-dot ${s.cwd_exists ? "live" : "gone"}`} />
                      <span innerHTML={s.snippet ?? escapeHtml(s.first_user_msg ?? s.session_id.slice(0, 8))} />
                    </td>
                    <td class="muted">{s.worktree_label ?? "—"}</td>
                    <td class="muted"><RelativeTime ms={s.started_at} /></td>
                    <td class="muted"><RelativeTime ms={s.last_activity} /></td>
                    <td class="muted">{s.message_count}</td>
                    <td
                      class="muted"
                      title={`input ${fmt(s.input_tokens)} · output ${fmt(s.output_tokens)} · cache ${fmt(s.cache_tokens)}`}
                    >
                      {fmt(s.input_tokens + s.output_tokens + s.cache_tokens)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>

          <div class="sessions-foot">
            <span class="muted">showing {rows().length} of {total()}</span>
            <Show when={hasMore()}>
              <button onclick={() => setOffset(rows().length)} disabled={page.loading}>
                {page.loading ? "loading…" : "load more"}
              </button>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
