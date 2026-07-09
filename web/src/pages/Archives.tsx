import { Show, createResource } from "solid-js";
import ProjectGrid from "../components/ProjectGrid";
import { fetchProjects } from "../api";

export default function Archives() {
  const [res, { refetch }] = createResource(() => fetchProjects("archived"));
  const list = () => res()?.projects ?? [];

  return (
    <div class="page">
      <h2 class="section-title">
        <span>archived</span>
        <Show when={list().length > 0}><span class="muted">{list().length}</span></Show>
      </h2>
      <Show when={list().length > 0} fallback={<div class="muted">no archived projects</div>}>
        <ProjectGrid projects={list()} onChange={() => refetch()} />
      </Show>
    </div>
  );
}
