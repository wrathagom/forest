import { createResource, createSignal, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchLiveSessions, markSessionDone, type LiveSessionRow } from "../api";
import RelativeTime from "./RelativeTime";
import { agentIcon } from "../lib/agents";

// A chip is clickable only if its session belongs to a known project — the session
// reader lives under the project route, so a session whose cwd maps to no project
// has nowhere to open and stays inert.
const hasProject = (s: LiveSessionRow): boolean => !!s.projectId;
// A Forest-launched session whose terminal is still open — clicking re-joins that terminal.
const isLiveForestSession = (s: LiveSessionRow): boolean => !!s.ptySessionId && s.endedAt === null;
// A closed session — its Forest PTY has exited (SessionEnd). External sessions have no endedAt.
const isClosed = (s: LiveSessionRow): boolean => s.endedAt !== null;
// A Codex chip is actionable only while its terminal is live in Forest — Codex
// sessions are never written to the vault, so there is no transcript to open once
// the terminal closes. Claude chips stay openable (their transcript persists).
const canOpen = (s: LiveSessionRow): boolean =>
  hasProject(s) && (s.agent !== "codex" || isLiveForestSession(s));

function chipTitle(s: LiveSessionRow): string {
  const parts = [`${s.agent}: ${s.lastUserMsg ?? s.agentSessionId}`];
  if (s.branch) parts.push(`branch: ${s.branch}`);
  if (s.worktreeLabel && s.worktreeLabel !== "main") parts.push(`worktree: ${s.worktreeLabel}`);
  if (!canOpen(s)) {
    parts.push(s.agent === "codex" ? "(codex — closed, not clickable)" : "(no project — not clickable)");
  } else if (!s.ptySessionId) {
    parts.push("(running outside Forest — click to view)");
  } else if (isClosed(s)) {
    parts.push("(closed — click to view)");
  }
  return parts.join("\n");
}

export default function SessionBar() {
  const navigate = useNavigate();
  const [sessions, { refetch }] = createResource(async () => (await fetchLiveSessions()).sessions);

  const interval = setInterval(() => {
    if (!document.hidden) void refetch();
  }, 3000);
  onCleanup(() => clearInterval(interval));

  // Sessions the user just removed, hidden immediately so the chip vanishes before
  // the next 3s poll. The server also filters dismissed sessions, so once the poll
  // lands the row stays gone; this set is belt-and-suspenders against the poll lag.
  const [removed, setRemoved] = createSignal<Set<string>>(new Set());
  const rows = () =>
    (sessions.error ? [] : sessions() ?? []).filter(
      // suppress only while still closed — if the session is resumed (server
      // un-dismisses it), it comes back not-closed and reappears on its own.
      (s) => !(removed().has(s.agentSessionId) && isClosed(s)),
    );

  const onRemove = (s: LiveSessionRow) => {
    setRemoved((prev) => new Set(prev).add(s.agentSessionId));
    void markSessionDone(s.agentSessionId)
      .then(() => refetch())
      .catch(() => {
        // dismissal failed — restore the chip so the user can try again
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(s.agentSessionId);
          return next;
        });
      });
  };

  const onChipClick = (s: LiveSessionRow) => {
    if (!canOpen(s)) return; // inert — nothing to open (esp. a closed Codex chip)
    if (isLiveForestSession(s)) {
      // its terminal is still open — focus it
      navigate(`/projects/${encodeURIComponent(s.projectId)}?term=${encodeURIComponent(s.ptySessionId!)}`);
      return;
    }
    // closed, or running outside Forest — open it in the session reader so you can
    // inspect the transcript (and confirm it isn't running elsewhere) before resuming.
    navigate(`/projects/${encodeURIComponent(s.projectId)}?session=${encodeURIComponent(s.agentSessionId)}`);
  };

  return (
    <Show when={rows().length > 0}>
      <div class="session-bar">
        <For each={rows()}>
          {(s) => (
            <div class="session-chip-wrap">
              <button
                type="button"
                class={`session-chip session-chip-${s.state}${canOpen(s) ? "" : " session-chip-inert"}`}
                title={chipTitle(s)}
                aria-disabled={!canOpen(s)}
                onClick={() => onChipClick(s)}
              >
                <span class={`session-chip-dot session-chip-dot-${isClosed(s) ? "closed" : s.state}`} />
                <span class="session-chip-agent" aria-hidden="true">{agentIcon(s.agent)}</span>
                <Show when={s.profile && s.profile !== "default"}>
                  <span class="session-profile-badge">{s.profile}</span>
                </Show>
                <span class="session-chip-project">{s.projectName ?? "unassigned"}</span>
                <span class="session-chip-time"><RelativeTime ms={s.lastEventAt} /></span>
              </button>
              <Show when={isClosed(s)}>
                <button
                  type="button"
                  class="session-chip-remove"
                  title="Remove session from bar"
                  aria-label="Remove session from bar"
                  onClick={() => onRemove(s)}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
