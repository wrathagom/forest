import { Show, createSignal, createResource } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useProjects } from "../projects-context";
import ProjectGrid from "../components/ProjectGrid";
import DashboardToolbar from "../components/DashboardToolbar";
import EmptyState from "../components/EmptyState";
import NewProjectModal from "../components/NewProjectModal";
import { createProject, fetchConfig, fetchProjects } from "../api";
import { sortProjects, searchProjects } from "../lib/project-list";
import { dashboardSort, dashboardColorBy, dashboardPreset } from "../lib/preferences";
import { groupsOf } from "../lib/colorBy";
import { currentTheme } from "../lib/themes/current";

export default function Dashboard() {
  const { projects, refetch } = useProjects();
  const nav = useNavigate();
  const [showModal, setShowModal] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [cfg] = createResource(fetchConfig);

  const visible = () => projects()?.projects ?? [];
  const pinned = () => visible().filter((p) => p.pinned);
  const others = () => sortProjects(visible().filter((p) => !p.pinned), dashboardSort());
  const empty = () => projects() && visible().length === 0;
  const searching = () => query().trim().length > 0;

  const [archivedRes, { refetch: refetchArchived }] = createResource(
    () => searching(),
    (isSearching) => (isSearching ? fetchProjects("archived") : Promise.resolve(undefined)),
  );
  const archived = () => archivedRes()?.projects ?? [];
  const results = () => searchProjects(visible(), archived(), query(), dashboardSort());

  // Search results merge visible + archived (see searchProjects), so a group
  // that exists only on an archived project must still be in this list.
  // bandColor() resolves a group to a hue by its index here and silently
  // returns the neutral band when the group is absent — so computing this over
  // visible() alone would make archived search hits mysteriously lose their
  // color, indistinguishable from a genuinely ungrouped project.
  const groups = () => groupsOf([...visible(), ...archived()]);

  const onChange = () => {
    refetch();
    refetchArchived();
  };

  return (
    <div class="page">
      <Show when={!empty()}>
        <DashboardToolbar query={query()} onQuery={setQuery} groups={groups()} theme={currentTheme()} />
      </Show>

      <Show
        when={!empty()}
        fallback={
          <EmptyState
            onConfigure={() => nav("/settings")}
            onNewProject={() => setShowModal(true)}
          />
        }
      >
        <Show
          when={searching()}
          fallback={
            <>
              <Show when={pinned().length > 0}>
                <h2 class="section-title">
                  <span>pinned</span>
                  <button class="section-add" onclick={() => setShowModal(true)} title="new project">+</button>
                </h2>
                <ProjectGrid
                  projects={pinned()}
                  preset={dashboardPreset()}
                  colorBy={dashboardColorBy()}
                  groups={groups()}
                  onChange={onChange}
                />
              </Show>
              <Show when={others().length > 0}>
                <h2 class="section-title">
                  <span>all</span>
                  <button class="section-add" onclick={() => setShowModal(true)} title="new project">+</button>
                </h2>
                <ProjectGrid
                  projects={others()}
                  preset={dashboardPreset()}
                  colorBy={dashboardColorBy()}
                  groups={groups()}
                  onChange={onChange}
                />
              </Show>
            </>
          }
        >
          <h2 class="section-title"><span>results</span></h2>
          <Show when={results().length > 0} fallback={<div class="muted">no projects match "{query()}"</div>}>
            <ProjectGrid
              projects={results()}
              preset={dashboardPreset()}
              colorBy={dashboardColorBy()}
              groups={groups()}
              onChange={onChange}
            />
          </Show>
        </Show>
      </Show>

      <Show when={showModal()}>
        <NewProjectModal
          subdirs={cfg()?.projectSubdirs ?? []}
          api={createProject}
          onCreated={(project) => {
            setShowModal(false);
            onChange();
            nav(`/projects/${encodeURIComponent(project.id)}`);
          }}
          onClose={() => setShowModal(false)}
        />
      </Show>
    </div>
  );
}
