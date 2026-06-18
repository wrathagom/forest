import { For, Show, createResource, createSignal, createEffect } from "solid-js";
import { listAgentSessions, type AgentSessionRow } from "../api";
import RelativeTime from "./RelativeTime";

export default function SessionsPanel(props: {
  projectId: string;
  enabled: () => boolean;
  onOpenSession: (sessionId: string, label: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [debounced, setDebounced] = createSignal("");

  createEffect(() => {
    const q = query();
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  });

  const [data, { refetch }] = createResource(
    () => (props.enabled() ? { projectId: props.projectId, q: debounced() } : null),
    async (key) => (key ? await listAgentSessions(key.projectId, { q: key.q || undefined }) : { sessions: [] }),
  );

  return (
    <div class="sessions-panel">
      <input
        class="sessions-search"
        placeholder="search sessions"
        value={query()}
        oninput={(e) => setQuery(e.currentTarget.value)}
      />
      <Show
        when={data()?.sessions.length}
        fallback={<div class="muted sessions-empty">no sessions yet</div>}
      >
        <ul class="sessions-list">
          <For each={data()!.sessions}>
            {(s) => (
              <li
                class="sessions-row"
                onclick={() => props.onOpenSession(s.session_id, s.first_user_msg ?? s.session_id.slice(0, 8))}
                title={s.cwd}
              >
                <span class={`sessions-dot ${s.cwd_exists ? "live" : "gone"}`} />
                <Show when={s.profile && s.profile !== "default"}>
                  <span class="session-profile-badge">{s.profile}</span>
                </Show>
                <span class="sessions-worktree">{s.worktree_label ?? "main"}</span>
                <span class="sessions-time">
                  <RelativeTime ms={s.last_activity} />
                </span>
                <span class="sessions-preview" innerHTML={s.snippet ?? escape(s.first_user_msg ?? "")} />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <button class="sessions-refresh" onclick={() => refetch()}>↻</button>
    </div>
  );
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
