import { createResource, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchLiveSessions, type LiveSessionRow } from "../api";
import RelativeTime from "./RelativeTime";

// A chip is clickable only if its session belongs to a known project — the session
// reader lives under the project route, so a session whose cwd maps to no project
// has nowhere to open and stays inert.
const hasProject = (s: LiveSessionRow): boolean => !!s.projectId;
// A Forest-launched session whose terminal is still open — clicking re-joins that terminal.
const isLiveForestSession = (s: LiveSessionRow): boolean => !!s.ptySessionId && s.endedAt === null;
// A closed session — its Forest PTY has exited (SessionEnd). External sessions have no endedAt.
const isClosed = (s: LiveSessionRow): boolean => s.endedAt !== null;

function chipTitle(s: LiveSessionRow): string {
  const parts = [s.lastUserMsg ?? s.agentSessionId];
  if (s.branch) parts.push(`branch: ${s.branch}`);
  if (s.worktreeLabel && s.worktreeLabel !== "main") parts.push(`worktree: ${s.worktreeLabel}`);
  if (!s.projectId) parts.push("(no project — not clickable)");
  else if (!s.ptySessionId) parts.push("(running outside Forest — click to view)");
  else if (isClosed(s)) parts.push("(closed — click to view)");
  return parts.join("\n");
}

export default function SessionBar() {
  const navigate = useNavigate();
  const [sessions, { refetch }] = createResource(async () => (await fetchLiveSessions()).sessions);

  const interval = setInterval(() => {
    if (!document.hidden) void refetch();
  }, 3000);
  onCleanup(() => clearInterval(interval));

  const rows = () => (sessions.error ? [] : sessions() ?? []);

  const onChipClick = (s: LiveSessionRow) => {
    if (!s.projectId) return; // inert — no project route to open under
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
            <button
              type="button"
              class={`session-chip session-chip-${s.state}${hasProject(s) ? "" : " session-chip-inert"}`}
              title={chipTitle(s)}
              disabled={!hasProject(s)}
              onClick={() => onChipClick(s)}
            >
              <span class={`session-chip-dot session-chip-dot-${isClosed(s) ? "closed" : s.state}`} />
              <Show when={s.profile && s.profile !== "default"}>
                <span class="session-profile-badge">{s.profile}</span>
              </Show>
              <span class="session-chip-project">{s.projectName ?? "unassigned"}</span>
              <span class="session-chip-time"><RelativeTime ms={s.lastEventAt} /></span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
