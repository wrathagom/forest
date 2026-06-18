import { createResource, createSignal, For, Show } from "solid-js";
import { fetchGitDiff, type GitDiffResponse } from "../api";

type Line = { kind: "ctx" | "add" | "del" | "hunk" | "meta"; text: string };

function classify(line: string): Line {
  if (line.startsWith("@@")) return { kind: "hunk", text: line };
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
    return { kind: "meta", text: line };
  }
  if (line.startsWith("+")) return { kind: "add", text: line };
  if (line.startsWith("-")) return { kind: "del", text: line };
  return { kind: "ctx", text: line };
}

export default function DiffView(props: {
  projectId: string;
  path: string;
  onOpenFile: (path: string) => void;
}) {
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [data] = createResource(
    () => ({ projectId: props.projectId, path: props.path, key: refreshKey() }),
    async ({ projectId, path }) => fetchGitDiff(projectId, path),
  );

  return (
    <div class="diff-view">
      <header class="diff-view-head">
        <span class="diff-view-path">{props.path}</span>
        <span class="diff-view-status muted">
          <Show when={data()?.status} fallback={<>clean</>}>
            {(s) => <>{s()}</>}
          </Show>
        </span>
        <button class="panel-retry" onclick={() => setRefreshKey((n) => n + 1)}>refresh</button>
        <button class="panel-retry" onclick={() => props.onOpenFile(props.path)}>edit file</button>
      </header>
      <div class="diff-view-body">
        <Show when={data.error}>
          <div class="banner banner-error">
            {(data.error as Error).message}
          </div>
        </Show>
        <Show when={data.loading}>
          <div class="muted">loading…</div>
        </Show>
        <Show when={data() && (data() as GitDiffResponse).status === null}>
          <div class="muted">
            no changes — file matches HEAD ·
            <button class="panel-retry" onclick={() => props.onOpenFile(props.path)}>edit file</button>
          </div>
        </Show>
        <Show when={data() && (data() as GitDiffResponse).diff.length > 0}>
          <pre class="diff-pre">
            <For each={(data() as GitDiffResponse).diff.split("\n")}>
              {(line) => {
                const c = classify(line);
                return <div class={`diff-line diff-${c.kind}`}>{c.text || " "}</div>;
              }}
            </For>
          </pre>
        </Show>
      </div>
    </div>
  );
}
