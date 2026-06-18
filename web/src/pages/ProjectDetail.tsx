import { createEffect, createSignal, For, Show, onCleanup, untrack, createMemo, createResource } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useParams, useSearchParams } from "@solidjs/router";
import { useProjects } from "../projects-context";
import { listSessions, createSession, killSession, createWorktree, fetchConfig, type SessionRow } from "../api";
import ProjectHeader from "../components/ProjectHeader";
import TabStrip from "../components/TabStrip";
import type { LauncherEntry } from "../components/LauncherButton";
import TerminalView from "../components/TerminalView";
import FileEditor from "../components/FileEditor";
import DiffView from "../components/DiffView";
import CommitView from "../components/CommitView";
import InfoPane from "../components/InfoPane";
import SessionTranscript from "../components/SessionTranscript";
import TaskView from "../components/TaskView";
import { persistedSignal } from "../lib/persisted";
import {
  loadOpenFiles,
  saveOpenFiles,
  loadActiveTab,
  saveActiveTab,
  type Tab,
} from "../lib/tabs";

type SessionsState = { rows: SessionRow[]; loaded: boolean; error: Error | null };
type FileTabState = { path: string; dirty: boolean };
type DiffTabState = { path: string };
type CommitTabState = { sha: string };
type SessionTabState = { sessionId: string; label: string };
type TaskTabState = { taskId: string; label: string };

export default function ProjectDetail() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects } = useProjects();
  const project = () => projects()?.projects.find((p) => p.id === params.id);

  // Sessions live in a store and updates go through reconcile() keyed on `id`,
  // so existing TerminalView components (and their xterm + WebSocket state)
  // survive a refetch when the data hasn't actually changed for that session.
  // Without this, the 10s safety-net poll would unmount and remount every
  // terminal each tick, killing focus + scrollback.
  const [state, setState] = createStore<SessionsState>({ rows: [], loaded: false, error: null });
  const [fileTabs, setFileTabs] = createStore<FileTabState[]>(
    loadOpenFiles(params.id).map((path) => ({ path, dirty: false })),
  );
  const [diffTabs, setDiffTabs] = createStore<DiffTabState[]>([]);
  const [commitTabs, setCommitTabs] = createStore<CommitTabState[]>([]);
  const [sessionTabs, setSessionTabs] = createStore<SessionTabState[]>([]);
  const [taskTabs, setTaskTabs] = createStore<TaskTabState[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(loadActiveTab(params.id));
  const [error, setError] = createSignal<string | null>(null);
  const [infoExpanded, setInfoExpanded] = persistedSignal("info.expanded", false);
  const [launchersRes] = createResource(async () => (await fetchConfig()).launchers ?? []);
  const [lastUsedLauncher, setLastUsedLauncher] = persistedSignal<string | null>("launcher.lastUsed", "shell");

  // Persist open files + active tab as they change
  createEffect(() => {
    saveOpenFiles(params.id, fileTabs.map((f) => f.path));
  });
  createEffect(() => {
    saveActiveTab(params.id, activeId());
  });

  // Session IDs we've auto-closed after a clean exit. The server retains exited
  // sessions for ~30s (so a reconnecting client can see final state), so the
  // safety-net poll below would otherwise resurrect the tab. UUIDs aren't
  // reused, so filtering these out permanently is safe.
  const closedSessions = new Set<string>();

  const refetchSessions = async () => {
    try {
      const fresh = (await listSessions(params.id)).filter((s) => !closedSessions.has(s.id));
      setState("rows", reconcile(fresh, { key: "id", merge: true }));
      setState("error", null);
      // If the persisted active tab no longer corresponds to a live tab, transition.
      untrack(() => {
        const id = activeId();
        const validTermIds = new Set(fresh.map((s) => `term:${s.id}`));
        const validFileIds = new Set(fileTabs.map((f) => `file:${f.path}`));
        const validDiffIds = new Set(diffTabs.map((d) => `diff:${d.path}`));
        const validCommitIds = new Set(commitTabs.map((c) => `commit:${c.sha}`));
        const validSessionIds = new Set(sessionTabs.map((s) => `session:${s.sessionId}`));
        const validTaskIds = new Set(taskTabs.map((t) => `task:${t.taskId}`));
        const isValid =
          id !== null &&
          (validTermIds.has(id) ||
            validFileIds.has(id) ||
            validDiffIds.has(id) ||
            validCommitIds.has(id) ||
            validSessionIds.has(id) ||
            validTaskIds.has(id));
        if (!isValid) {
          if (fresh[0]) setActiveId(`term:${fresh[0].id}`);
          else if (fileTabs[0]) setActiveId(`file:${fileTabs[0].path}`);
          else setActiveId(null);
        }
      });
    } catch (err) {
      setState("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      setState("loaded", true);
    }
  };

  // Initial fetch + resync when params.id changes (route navigation).
  createEffect(() => {
    void params.id;
    untrack(() => void refetchSessions());
  });

  // When the route changes, reload file-tab state for the new project.
  let lastProjectId = params.id;
  createEffect(() => {
    const id = params.id;
    if (id === lastProjectId) return;
    lastProjectId = id;
    untrack(() => {
      setFileTabs(reconcile(loadOpenFiles(id).map((path) => ({ path, dirty: false }))));
      setActiveId(loadActiveTab(id));
    });
  });

  // Safety-net poll. Local mutations on create/kill keep us mostly in sync;
  // this just catches state changes from outside the page (rare).
  const interval = setInterval(() => void refetchSessions(), 10_000);
  onCleanup(() => clearInterval(interval));

  const tabs = createMemo<Tab[]>(() => [
    ...state.rows.map(
      (s, i): Tab => ({
        kind: "terminal",
        id: `term:${s.id}`,
        sessionId: s.id,
        label: `term ${i + 1}`,
        agent: s.agent,
      }),
    ),
    ...fileTabs.map(
      (f): Tab => ({
        kind: "file",
        id: `file:${f.path}`,
        path: f.path,
        label: f.path.split("/").pop() ?? f.path,
        dirty: f.dirty,
      }),
    ),
    ...diffTabs.map(
      (d): Tab => ({
        kind: "diff",
        id: `diff:${d.path}`,
        path: d.path,
        label: `diff: ${d.path.split("/").pop() ?? d.path}`,
      }),
    ),
    ...commitTabs.map(
      (c): Tab => ({
        kind: "commit",
        id: `commit:${c.sha}`,
        sha: c.sha,
        label: `commit ${c.sha.slice(0, 7)}`,
      }),
    ),
    ...sessionTabs.map(
      (s): Tab => ({
        kind: "session",
        id: `session:${s.sessionId}`,
        sessionId: s.sessionId,
        label: s.label.length > 28 ? s.label.slice(0, 28) + "…" : s.label,
      }),
    ),
    ...taskTabs.map(
      (t): Tab => ({
        kind: "task",
        id: `task:${t.taskId}`,
        taskId: t.taskId,
        label: t.label.length > 24 ? t.label.slice(0, 24) + "…" : t.label,
      }),
    ),
  ]);

  const activeFilePath = () => {
    const id = activeId();
    if (!id || !id.startsWith("file:")) return null;
    return id.slice("file:".length);
  };

  const openFile = (path: string) => {
    const id = `file:${path}`;
    if (!fileTabs.some((f) => f.path === path)) {
      setFileTabs((prev) => [...prev, { path, dirty: false }]);
    }
    setActiveId(id);
  };

  const openDiff = (path: string) => {
    const id = `diff:${path}`;
    if (!diffTabs.some((d) => d.path === path)) {
      setDiffTabs((prev) => [...prev, { path }]);
    }
    setActiveId(id);
  };

  const openCommit = (sha: string) => {
    const id = `commit:${sha}`;
    if (!commitTabs.some((c) => c.sha === sha)) {
      setCommitTabs((prev) => [...prev, { sha }]);
    }
    setActiveId(id);
  };

  const openSessionTab = (sessionId: string, label: string) => {
    const id = `session:${sessionId}`;
    if (!sessionTabs.some((s) => s.sessionId === sessionId)) {
      setSessionTabs((prev) => [...prev, { sessionId, label }]);
    }
    setActiveId(id);
  };

  const openTask = (taskId: string, title: string) => {
    const id = `task:${taskId}`;
    if (!taskTabs.some((t) => t.taskId === taskId)) {
      setTaskTabs((prev) => [...prev, { taskId, label: title || `task ${taskId.slice(0, 6)}` }]);
    }
    setActiveId(id);
  };

  // Deep-link support: /projects/:id?session=<sid> opens that agent session as a tab.
  createEffect(() => {
    const sid = searchParams.session;
    if (typeof sid === "string" && sid.length > 0) {
      openSessionTab(sid, sid.slice(0, 8));
      setSearchParams({ session: undefined }, { replace: true });
    }
  });

  // Deep-link support: /projects/:id?term=<ptyId> selects that terminal tab.
  // The row may not be in `state.rows` on first run (refetchSessions is async),
  // so this effect re-runs when rows change; we only clear the param once matched.
  createEffect(() => {
    const t = searchParams.term;
    if (typeof t === "string" && t.length > 0 && state.rows.some((s) => s.id === t)) {
      setActiveId(`term:${t}`);
      setSearchParams({ term: undefined }, { replace: true });
    }
  });

  const onSelect = (id: string) => setActiveId(id);

  const onClose = async (id: string) => {
    const tab = tabs().find((t) => t.id === id);
    if (!tab) return;
    if (tab.kind === "terminal") {
      try {
        await killSession(tab.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      const remaining = state.rows.filter((s) => s.id !== tab.sessionId);
      setState("rows", reconcile(remaining, { key: "id", merge: true }));
    } else if (tab.kind === "file") {
      const remaining = fileTabs.filter((f) => f.path !== tab.path);
      setFileTabs(reconcile(remaining));
    } else if (tab.kind === "diff") {
      const remaining = diffTabs.filter((d) => d.path !== tab.path);
      setDiffTabs(reconcile(remaining));
    } else if (tab.kind === "commit") {
      const remaining = commitTabs.filter((c) => c.sha !== tab.sha);
      setCommitTabs(reconcile(remaining));
    } else if (tab.kind === "session") {
      const remaining = sessionTabs.filter((s) => s.sessionId !== tab.sessionId);
      setSessionTabs(reconcile(remaining));
    } else if (tab.kind === "task") {
      const remaining = taskTabs.filter((t) => t.taskId !== tab.taskId);
      setTaskTabs(reconcile(remaining));
    }
    if (activeId() === id) {
      const next = tabs().find((t) => t.id !== id);
      setActiveId(next?.id ?? null);
    }
  };

  // Auto-close a terminal tab when its session exits cleanly (code 0). Non-zero
  // exits stay open so the error output remains visible. The server already
  // tears down the session registry entry on pty exit, so no kill call needed.
  const onSessionExit = (sessionId: string, code: number | null) => {
    if (code !== 0) return;
    closedSessions.add(sessionId);
    const tabId = `term:${sessionId}`;
    const remaining = state.rows.filter((s) => s.id !== sessionId);
    setState("rows", reconcile(remaining, { key: "id", merge: true }));
    if (activeId() === tabId) {
      const next = tabs().find((t) => t.id !== tabId);
      setActiveId(next?.id ?? null);
    }
  };

  const onLaunch = async (entry: LauncherEntry) => {
    setError(null);
    try {
      const s = await createSession(params.id, { cols: 80, rows: 24, launcherId: entry.id });
      setState("rows", reconcile([...state.rows, s], { key: "id", merge: true }));
      setActiveId(`term:${s.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const setFileDirty = (path: string, dirty: boolean) => {
    const idx = fileTabs.findIndex((f) => f.path === path);
    if (idx >= 0) setFileTabs(idx, "dirty", dirty);
  };

  return (
    <div class={`project-detail ${infoExpanded() ? "with-info" : ""}`}>
      <Show when={project()} fallback={<div class="muted" style={{ padding: "1.2rem" }}>loading project…</div>}>
        {(p) => <ProjectHeader project={p()} />}
      </Show>
      <TabStrip
        tabs={tabs()}
        activeId={activeId()}
        onSelect={onSelect}
        onClose={onClose}
        onLaunch={onLaunch}
        launchers={launchersRes() ?? []}
        lastUsedLauncher={lastUsedLauncher()}
        onChangeLastUsedLauncher={setLastUsedLauncher}
        infoExpanded={infoExpanded}
        onToggleInfo={() => setInfoExpanded(!infoExpanded())}
      />
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <div class="terminal-area">
        <Show
          when={tabs().length > 0}
          fallback={
            <div class="terminal-empty">
              <p class="muted">no terminals yet — click + to start one, or open a file from the tree</p>
            </div>
          }
        >
          <For each={state.rows}>
            {(s) => (
              <TerminalView
                projectId={params.id}
                sessionId={s.id}
                visible={activeId() === `term:${s.id}`}
                onExit={(code) => onSessionExit(s.id, code)}
              />
            )}
          </For>
          <For each={fileTabs}>
            {(f) => (
              <Show when={activeId() === `file:${f.path}`}>
                <FileEditor
                  projectId={params.id}
                  path={f.path}
                  onDirtyChange={(dirty) => setFileDirty(f.path, dirty)}
                />
              </Show>
            )}
          </For>
          <For each={diffTabs}>
            {(d) => (
              <Show when={activeId() === `diff:${d.path}`}>
                <DiffView
                  projectId={params.id}
                  path={d.path}
                  onOpenFile={openFile}
                />
              </Show>
            )}
          </For>
          <For each={commitTabs}>
            {(c) => (
              <Show when={activeId() === `commit:${c.sha}`}>
                <CommitView projectId={params.id} sha={c.sha} />
              </Show>
            )}
          </For>
          <For each={taskTabs}>
            {(t) => (
              <Show when={activeId() === `task:${t.taskId}`}>
                <TaskView
                  taskId={t.taskId}
                  visible={activeId() === `task:${t.taskId}`}
                  onOpenSession={openSessionTab}
                  onClose={() => void onClose(`task:${t.taskId}`)}
                />
              </Show>
            )}
          </For>
          <For each={sessionTabs}>
            {(s) => (
              <Show when={activeId() === `session:${s.sessionId}`}>
                <SessionTranscript
                  sessionId={s.sessionId}
                  onResume={async (kind, detail) => {
                    let cwd = detail.session.cwd;
                    if (kind === "in-main") {
                      cwd = project()?.path ?? cwd;
                    } else if (kind === "recreate-worktree") {
                      if (!detail.session.branch) {
                        setError("session has no branch recorded");
                        return;
                      }
                      try {
                        const wt = await createWorktree(params.id, {
                          branch: detail.session.branch,
                          name: detail.session.worktree_label ?? detail.session.branch,
                        });
                        cwd = wt.path;
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                        return;
                      }
                    }
                    const ses = await createSession(params.id, {
                      cwd, command: "claude",
                      args: [
                        "--resume", detail.session.session_id,
                        "--permission-mode", "bypassPermissions",
                      ],
                      cols: 80, rows: 24,
                    });
                    setState("rows", reconcile([...state.rows, ses], { key: "id", merge: true }));
                    setActiveId(`term:${ses.id}`);
                  }}
                />
              </Show>
            )}
          </For>
        </Show>
      </div>
      <InfoPane
        projectId={params.id}
        expanded={infoExpanded}
        activeFilePath={activeFilePath}
        onOpenFile={openFile}
        onOpenDiff={openDiff}
        onOpenCommit={openCommit}
        onOpenSession={openSessionTab}
        onOpenTask={openTask}
      />
    </div>
  );
}
