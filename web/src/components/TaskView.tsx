import { createResource, createEffect, onCleanup, For, Show, createSignal } from "solid-js";
import { getTaskDetail, patchTask, deleteTask, type Task, type TaskResult, type TaskStatus } from "../api";

const POLL_MS = 5000;

type DiffLineKind = "ctx" | "add" | "del" | "hunk" | "meta";

function classifyDiff(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---") ||
      line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

const ACTIONS: Array<{ label: string; status: TaskStatus; result: TaskResult; cls: string }> = [
  { label: "Merge to main", status: "done", result: "merged", cls: "task-act-merge" },
  { label: "Open PR", status: "done", result: "pr", cls: "task-act-pr" },
  { label: "Keep / detach", status: "done", result: "detached", cls: "task-act-keep" },
  { label: "Discard", status: "abandoned", result: "discarded", cls: "task-act-discard" },
];

export default function TaskView(props: {
  taskId: string;
  visible: boolean;
  onOpenSession: (sessionId: string, label: string) => void;
  onClose?: () => void;
}) {
  const [data, { refetch }] = createResource(
    () => props.taskId,
    async (id) => getTaskDetail(id),
  );

  createEffect(() => {
    if (!props.visible) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const del = async () => {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(props.taskId);
      props.onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const act = async (status: TaskStatus, result?: TaskResult) => {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await patchTask(props.taskId, result ? { status, result } : { status });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="task-view">
      <Show when={data.error}>
        <div class="banner banner-error">{(data.error as Error).message}</div>
      </Show>
      <Show when={data.loading && !data()}>
        <div class="muted">loading…</div>
      </Show>
      <Show when={data()}>
        {(d) => {
          const task = (): Task => d().task;
          return (
            <>
              <header class="task-view-head">
                <span class="task-view-title">{task().title}</span>
                <span class={`task-badge tasks-dot-${task().status}`}>{task().status}</span>
                <div class="task-view-meta muted">
                  <Show when={task().branch}>{task().branch} · </Show>
                  <Show when={task().worktreePath}>{task().worktreePath} · </Show>
                  forked from {task().baseBranch}
                </div>
              </header>

              <section class="task-view-section">
                <div class="task-view-label">INTENT</div>
                <pre class="task-view-intent">{task().intent}</pre>
              </section>

              <Show when={task().sessionId}>
                <section class="task-view-section">
                  <div class="task-view-label">AGENT SESSION</div>
                  <button
                    class="task-view-link"
                    onclick={() => props.onOpenSession(task().sessionId!, task().title)}
                  >
                    open transcript ↗
                  </button>
                </section>
              </Show>

              <Show when={d().diff}>
                <section class="task-view-section">
                  <div class="task-view-label">CHANGES</div>
                  <pre class="diff-pre">
                    <For each={d().diff!.split("\n")}>
                      {(line) => (
                        <div class={`diff-line diff-${classifyDiff(line)}`}>{line || " "}</div>
                      )}
                    </For>
                  </pre>
                </section>
              </Show>

              <Show when={error()}>
                <div class="banner banner-error">{error()}</div>
              </Show>

              <div class="task-view-actions">
                <Show when={task().status === "draft"}>
                  <button disabled={busy()} onclick={() => void act("running")}>Launch</button>
                  <button class="task-act-discard" disabled={busy()} onclick={() => void del()}>Delete</button>
                </Show>
                <Show when={task().status === "running" || task().status === "review"}>
                  <For each={ACTIONS}>
                    {(a) => (
                      <button
                        class={a.cls}
                        disabled={busy()}
                        onclick={() => void act(a.status, a.result)}
                      >
                        {a.label}
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={task().status === "done" || task().status === "abandoned"}>
                  <span class="muted">
                    {task().result}
                    <Show when={task().resultRef}> · {task().resultRef}</Show>
                  </span>
                </Show>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}
