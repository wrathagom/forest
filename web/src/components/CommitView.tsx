import { createResource, For, Show } from "solid-js";
import { fetchGitCommit, type GitCommitResponse } from "../api";
import RelativeTime from "./RelativeTime";

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

export default function CommitView(props: {
  projectId: string;
  sha: string;
}) {
  const [data] = createResource(
    () => ({ projectId: props.projectId, sha: props.sha }),
    async ({ projectId, sha }) => fetchGitCommit(projectId, sha),
  );

  return (
    <div class="commit-view">
      <Show when={data.error}>
        <div class="banner banner-error">
          {(data.error as Error).message}
        </div>
      </Show>
      <Show when={data.loading}>
        <div class="muted">loading…</div>
      </Show>
      <Show when={data()}>
        {(c) => (
          <>
            <header class="commit-view-head">
              <div class="commit-view-sha">{c().sha}</div>
              <div class="commit-view-author">
                {c().author} · <RelativeTime ms={c().timestamp} />
              </div>
              <Show when={c().parents.length > 0}>
                <div class="commit-view-parents muted">
                  parents: {c().parents.map((p) => p.slice(0, 7)).join(", ")}
                </div>
              </Show>
              <pre class="commit-view-message">{c().message}</pre>
            </header>
            <div class="commit-view-body">
              <pre class="diff-pre">
                <For each={c().diff.split("\n")}>
                  {(line) => {
                    const cl = classify(line);
                    return <div class={`diff-line diff-${cl.kind}`}>{line || " "}</div>;
                  }}
                </For>
              </pre>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
