import { createResource, createEffect, onCleanup, For, Show, createSignal, untrack } from "solid-js";
import { listTasks, createTask, type Task, type TaskStatus } from "../api";

const POLL_MS = 5000;

const BUCKETS: Array<{ label: string; match: (s: TaskStatus) => boolean }> = [
  { label: "⚠ Needs you", match: (s) => s === "review" },
  { label: "Running", match: (s) => s === "running" },
  { label: "Draft", match: (s) => s === "draft" },
  { label: "Done", match: (s) => s === "done" || s === "abandoned" },
];

function taskMeta(t: Task): string {
  if ((t.status === "done" || t.status === "abandoned") && t.result) return t.result;
  return t.status;
}

export default function TasksPanel(props: {
  projectId: string;
  enabled: () => boolean;
  onOpenTask: (taskId: string, title: string) => void;
}) {
  const [data, { refetch }] = createResource(
    () => (props.enabled() ? props.projectId : null),
    async (pid) => (pid ? await listTasks(pid) : { tasks: [] as Task[] }),
  );

  createEffect(() => {
    if (!props.enabled()) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const [composing, setComposing] = createSignal(false);
  const [intent, setIntent] = createSignal("");
  const [baseBranch, setBaseBranch] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (launch: boolean) => {
    const text = intent().trim();
    if (!text || untrack(busy)) return;
    setBusy(true);
    setError(null);
    try {
      await createTask(props.projectId, {
        intent: text,
        baseBranch: baseBranch().trim() || undefined,
        status: launch ? "running" : undefined,
      });
      setIntent("");
      setBaseBranch("");
      setComposing(false);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tasksIn = (match: (s: TaskStatus) => boolean) =>
    (data()?.tasks ?? []).filter((t) => match(t.status));

  return (
    <div class="tasks-panel sessions-panel">
      <Show when={!composing()}>
        <button class="tasks-new" onclick={() => setComposing(true)}>+ New Task</button>
      </Show>
      <Show when={composing()}>
        <div class="tasks-composer">
          <textarea
            class="tasks-intent"
            placeholder="what are you trying to do?"
            value={intent()}
            oninput={(e) => setIntent(e.currentTarget.value)}
          />
          <input
            class="tasks-base"
            placeholder="base branch (optional)"
            value={baseBranch()}
            oninput={(e) => setBaseBranch(e.currentTarget.value)}
          />
          <div class="tasks-composer-actions">
            <button disabled={busy() || !intent().trim()} onclick={() => void submit(true)}>Launch</button>
            <button disabled={busy() || !intent().trim()} onclick={() => void submit(false)}>Save draft</button>
            <button onclick={() => { setComposing(false); setError(null); }}>Cancel</button>
          </div>
          <Show when={error()}>
            <div class="banner banner-error">{error()}</div>
          </Show>
        </div>
      </Show>
      <div class="tasks-buckets">
        <For each={BUCKETS}>
          {(bucket) => {
            const rows = () => tasksIn(bucket.match);
            return (
              <Show when={rows().length > 0}>
                <div class="tasks-bucket">
                  <div class="tasks-bucket-label">{bucket.label} · {rows().length}</div>
                  <ul class="sessions-list">
                    <For each={rows()}>
                      {(t) => (
                        <li class="sessions-row tasks-row" onclick={() => props.onOpenTask(t.id, t.title)}>
                          <span class={`tasks-dot tasks-dot-${t.status}`} />
                          <span class="tasks-row-title">{t.title}</span>
                          <span class="tasks-row-meta muted">{taskMeta(t)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            );
          }}
        </For>
        <Show when={data() && data()!.tasks.length === 0}>
          <div class="muted">no tasks yet</div>
        </Show>
      </div>
    </div>
  );
}
