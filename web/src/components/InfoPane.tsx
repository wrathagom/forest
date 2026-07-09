import { createResource, createEffect, onCleanup, Show } from "solid-js";
import { persistedSignal } from "../lib/persisted";
import { fetchTree } from "../api";
import MonitorPanel from "./MonitorPanel";
import FileTreePanel from "./FileTreePanel";
import GitPanel from "./GitPanel";
import SessionsPanel from "./SessionsPanel";
import TasksPanel from "./TasksPanel";

type Tab = "monitor" | "files" | "git" | "sessions" | "tasks";

function migrate(value: unknown): Tab {
  if (value === "monitor" || value === "files" || value === "git" || value === "sessions" || value === "tasks") return value;
  if (value === "processes" || value === "containers") return "monitor";
  return "monitor";
}

export default function InfoPane(props: {
  projectId: string;
  expanded: () => boolean;
  highlightedPaths: () => string[];
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFileRight: (path: string) => void;
  onOpenCommit: (sha: string) => void;
  onOpenSession: (sessionId: string, label: string) => void;
  onOpenTask: (taskId: string, title: string) => void;
}) {
  const [rawTab, setActiveTab] = persistedSignal<Tab>("info.tab", "monitor");
  const activeTab = () => migrate(rawTab());

  const filesEnabled = () => props.expanded() && activeTab() === "files";
  const [tree, { refetch: refetchTree }] = createResource(
    () => (filesEnabled() ? props.projectId : null),
    async (key) => (key === null ? undefined : await fetchTree(key)),
  );
  createEffect(() => {
    if (!filesEnabled()) return;
    const id = setInterval(() => void refetchTree(), 5000);
    onCleanup(() => clearInterval(id));
  });

  return (
    <Show when={props.expanded()}>
      <aside class="info-pane">
        <nav class="info-pane-tabs">
          <button class={`info-pane-tab ${activeTab() === "monitor" ? "active" : ""}`} onclick={() => setActiveTab("monitor")}>monitor</button>
          <button class={`info-pane-tab ${activeTab() === "files" ? "active" : ""}`} onclick={() => setActiveTab("files")}>files</button>
          <button class={`info-pane-tab ${activeTab() === "git" ? "active" : ""}`} onclick={() => setActiveTab("git")}>git</button>
          <button class={`info-pane-tab ${activeTab() === "sessions" ? "active" : ""}`} onclick={() => setActiveTab("sessions")}>sessions</button>
          <button class={`info-pane-tab ${activeTab() === "tasks" ? "active" : ""}`} onclick={() => setActiveTab("tasks")}>tasks</button>
        </nav>
        <div class="info-pane-body">
          <Show when={activeTab() === "monitor"}>
            <MonitorPanel projectId={props.projectId} enabled={() => props.expanded() && activeTab() === "monitor"} />
          </Show>
          <Show when={activeTab() === "files"}>
            <Show when={tree()?.entries} fallback={<div class="muted">loading…</div>}>
              <FileTreePanel
                projectId={props.projectId}
                entries={tree()!.entries}
                highlightedPaths={props.highlightedPaths()}
                onOpenFile={props.onOpenFile}
                onOpenDiff={props.onOpenDiff}
                onOpenFileRight={props.onOpenFileRight}
              />
            </Show>
          </Show>
          <Show when={activeTab() === "git"}>
            <GitPanel
              projectId={props.projectId}
              enabled={() => props.expanded() && activeTab() === "git"}
              onOpenCommit={props.onOpenCommit}
            />
          </Show>
          <Show when={activeTab() === "sessions"}>
            <SessionsPanel
              projectId={props.projectId}
              enabled={() => props.expanded() && activeTab() === "sessions"}
              onOpenSession={props.onOpenSession}
            />
          </Show>
          <Show when={activeTab() === "tasks"}>
            <TasksPanel
              projectId={props.projectId}
              enabled={() => props.expanded() && activeTab() === "tasks"}
              onOpenTask={props.onOpenTask}
            />
          </Show>
        </div>
      </aside>
    </Show>
  );
}
