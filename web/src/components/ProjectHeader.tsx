import { Show } from "solid-js";
import { A } from "@solidjs/router";
import type { ProjectRow } from "../api";
import RelativeTime from "./RelativeTime";

const SUBJECT_LIMIT = 50;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export default function ProjectHeader(props: { project: ProjectRow }) {
  const snap = () => props.project.snapshot;
  return (
    <header class="project-header">
      <div class="project-breadcrumb">
        <A href="/" class="nav-link"><span class="brand-mark">ƒ</span>orest</A>
        <span class="muted">›</span>
        <span class="project-name">{props.project.name}</span>
        <Show when={props.project.group}>
          <span class="group-tag">{props.project.group}</span>
        </Show>
      </div>
      <div class="project-meta">
        <Show when={snap()}>
          {(s) => (
            <>
              <span class="branch">{s().git.branch ?? "detached"}</span>
              <Show
                when={s().git.dirty}
                fallback={<span class="git-stat git-clean">clean</span>}
              >
                <span class="git-stat git-dirty">+{s().git.changed}</span>
              </Show>
              <Show when={s().git.ahead > 0}>
                <span class="git-stat git-ahead">↑{s().git.ahead}</span>
              </Show>
              <Show when={s().git.behind > 0}>
                <span class="git-stat git-behind">↓{s().git.behind}</span>
              </Show>
              <Show when={s().git.lastCommit}>
                {(c) => (
                  <span class="git-last-commit muted" title={c().message}>
                    {truncate(c().message, SUBJECT_LIMIT)} · <RelativeTime ms={c().timestamp} />
                  </span>
                )}
              </Show>
            </>
          )}
        </Show>
      </div>
    </header>
  );
}
