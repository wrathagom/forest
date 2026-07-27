import { Show, createResource } from "solid-js";
import ProjectGrid from "../components/ProjectGrid";
import { fetchProjects } from "../api";
import { groupsOf } from "../lib/colorBy";
import { dashboardPreset, dashboardColorBy } from "../lib/preferences";
import { useProjects } from "../projects-context";

export default function Archives() {
  const [res, { refetch }] = createResource(() => fetchProjects("archived"));
  const list = () => res()?.projects ?? [];

  // Group hues are assigned by index into this list, so it has to be derived
  // from the same set of projects the dashboard uses — otherwise a group would
  // be one colour here and a different one there, which defeats the point of
  // colouring by group. The visible list comes free from the app-wide context
  // (already loaded and polling), so this costs no extra request.
  const { projects } = useProjects();
  const groups = () => groupsOf([...(projects()?.projects ?? []), ...list()]);

  return (
    <div class="page">
      <h2 class="section-title">
        <span>archived</span>
        <Show when={list().length > 0}><span class="muted">{list().length}</span></Show>
      </h2>
      <Show when={list().length > 0} fallback={<div class="muted">no archived projects</div>}>
        <ProjectGrid
          projects={list()}
          preset={dashboardPreset()}
          colorBy={dashboardColorBy()}
          groups={groups()}
          onChange={() => refetch()}
        />
      </Show>
    </div>
  );
}
