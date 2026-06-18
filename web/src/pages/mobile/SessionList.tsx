import { createSignal, For, Show, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchMobileSessions, type MobileListItem, type MobileSessionsResponse } from "../../api";
import RelativeTime from "../../components/RelativeTime";

function Row(props: { item: MobileListItem; onclick: () => void }) {
  return (
    <button type="button" class="m-row" data-state={props.item.state} onclick={props.onclick}>
      <div class="m-row-title">{props.item.projectName ?? "—"}</div>
      <div class="m-row-label">{props.item.label}</div>
      <Show when={props.item.snippet}>
        <div class="m-row-snippet">{props.item.snippet}</div>
      </Show>
      <div class="m-row-meta">
        {props.item.state}{props.item.launchedVia === "mobile" ? " · 📱" : ""} · <RelativeTime ms={props.item.lastActivity} />
      </div>
    </button>
  );
}

export default function SessionList() {
  const navigate = useNavigate();
  const [data, setData] = createSignal<MobileSessionsResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    try {
      const res = await fetchMobileSessions();
      if (mine === seq) { setData(res); setError(null); }
    } catch (err) {
      if (mine === seq) setError(err instanceof Error ? err.message : String(err));
    }
  };

  void load();
  const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
  onCleanup(() => clearInterval(t));

  const open = (i: MobileListItem) => navigate(`/m/s/${encodeURIComponent(i.sessionId)}`);
  const isEmpty = () => {
    const d = data();
    return !!d && d.needsYou.length === 0 && d.working.length === 0 && d.recent.length === 0;
  };

  return (
    <>
      <button type="button" class="m-btn m-btn-top" onclick={() => navigate("/m/new")}>+ new run</button>
      <Show when={error()}>
        <div class="m-error">failed to load: {error()}</div>
      </Show>
      <Show when={isEmpty()}>
        <div class="m-empty">no sessions yet — start one above.</div>
      </Show>
      <Show when={(data()?.needsYou.length ?? 0) > 0}>
        <div class="m-section-label">⏳ your turn ({data()!.needsYou.length})</div>
        <For each={data()!.needsYou}>{(i) => <Row item={i} onclick={() => open(i)} />}</For>
      </Show>
      <Show when={(data()?.working.length ?? 0) > 0}>
        <div class="m-section-label">⚙ working ({data()!.working.length})</div>
        <For each={data()!.working}>{(i) => <Row item={i} onclick={() => open(i)} />}</For>
      </Show>
      <Show when={(data()?.recent.length ?? 0) > 0}>
        <div class="m-section-label">recent</div>
        <For each={data()!.recent}>{(i) => <Row item={i} onclick={() => open(i)} />}</For>
      </Show>
    </>
  );
}
