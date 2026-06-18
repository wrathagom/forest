import { Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ProjectRow } from "../api";
import { refreshProject, patchProject } from "../api";
import RelativeTime from "./RelativeTime";
import ServiceList from "./ServiceList";

export default function ProjectCard(props: { project: ProjectRow; onChange: () => void }) {
  const nav = useNavigate();

  const status = (): "ok" | "warn" | "error" => {
    const s = props.project.snapshot;
    if (!s) return "warn";
    if (s.errors.length > 0) return "error";
    if (s.git.dirty) return "warn";
    return "ok";
  };

  const onRefresh = async (e: MouseEvent) => {
    e.stopPropagation();
    await refreshProject(props.project.id);
    props.onChange();
  };

  const onPin = async (e: MouseEvent) => {
    e.stopPropagation();
    await patchProject(props.project.id, { pinned: !props.project.pinned });
    props.onChange();
  };

  const onArchive = async (e: MouseEvent) => {
    e.stopPropagation();
    await patchProject(props.project.id, { hidden: !props.project.hidden });
    props.onChange();
  };

  const onCardClick = (e: MouseEvent) => {
    // Bail if the click landed inside an action button.
    const target = e.target as HTMLElement;
    if (target.closest(".card-actions")) return;
    nav(`/projects/${encodeURIComponent(props.project.id)}`);
  };

  return (
    <div class={`card status-${status()} card-clickable`} onclick={onCardClick}>
      <div class="card-head">
        <div class="card-title">
          <span class={`dot dot-${status()}`} />
          <span class="card-name">{props.project.name}</span>
          <Show when={props.project.group}>
            <span class="group-tag" title="inferred from sub-directory under scan root">
              {props.project.group}
            </span>
          </Show>
          <Show when={props.project.pinned && !props.project.hidden}><span class="pin" title="pinned">★</span></Show>
          <Show when={props.project.hidden}>
            <span class="archived-tag" title="archived">archived</span>
          </Show>
        </div>
        <div class="card-actions">
          <button onclick={onRefresh} title="refresh">⟳</button>
          <Show
            when={!props.project.hidden}
            fallback={<button onclick={onArchive} title="restore">restore</button>}
          >
            <button onclick={onPin} title="pin">{props.project.pinned ? "unpin" : "pin"}</button>
            <button onclick={onArchive} title="archive">archive</button>
          </Show>
        </div>
      </div>
      <Show when={props.project.snapshot} fallback={<div class="muted">no snapshot yet</div>}>
        {(snap) => (
          <>
            <div class="card-meta">
              <span class="branch">{snap().git.branch ?? "detached"}</span>
              <Show
                when={snap().git.dirty}
                fallback={<span class="git-stat git-clean">clean</span>}
              >
                <span class="git-stat git-dirty">+{snap().git.changed}</span>
              </Show>
              <Show when={snap().git.ahead > 0}>
                <span class="git-stat git-ahead" title="commits ahead of upstream">↑{snap().git.ahead}</span>
              </Show>
              <Show when={snap().git.behind > 0}>
                <span class="git-stat git-behind" title="commits behind upstream">↓{snap().git.behind}</span>
              </Show>
              <Show when={snap().git.lastCommit}>
                <span class="muted">·</span>
                <RelativeTime ms={snap().git.lastCommit!.timestamp} />
              </Show>
            </div>
            <Show when={props.project.liveAgents && props.project.liveAgents.length > 0}>
              <span
                class="agent-badge"
                title={props.project.liveAgents.map((a) => `${a.count} ${a.agent}`).join(", ")}
              >
                🤖 {props.project.liveAgents.reduce((n, a) => n + a.count, 0)}
              </span>
            </Show>
            <div class="card-section">
              <span class="label">services</span>
              <ServiceList services={snap().services} liveSessions={props.project.liveSessions} />
            </div>
            <Show when={snap().errors.length > 0}>
              <div class="card-section warn">
                <span class="label">issues</span>
                <ul>
                  {snap().errors.map((e) => <li>{e}</li>)}
                </ul>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
