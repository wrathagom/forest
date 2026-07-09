import { Show, createSignal, createResource } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useProjects } from "../projects-context";
import ProjectGrid from "../components/ProjectGrid";
import EmptyState from "../components/EmptyState";
import NewProjectModal from "../components/NewProjectModal";
import { createProject, fetchConfig, fetchProjects } from "../api";
import { sortProjects, searchProjects, type ProjectSort } from "../lib/project-list";
import { dashboardSort, setDashboardSort } from "../lib/preferences";

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

  const onChange = () => {
    refetch();
    refetchArchived();
  };

  return (
    <div class="page">
      <Show when={!empty()}>
        <div class="dashboard-toolbar">
          <input
            class="search-input"
            type="search"
            placeholder="search projects…"
            value={query()}
            oninput={(e) => setQuery(e.currentTarget.value)}
          />
          <select
            class="sort-select"
            value={dashboardSort()}
            onchange={(e) => setDashboardSort(e.currentTarget.value as ProjectSort)}
          >
            <option value="recent">recent</option>
            <option value="running">running</option>
            <option value="name">name</option>
          </select>
        </div>
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
                <ProjectGrid projects={pinned()} onChange={onChange} />
              </Show>
              <Show when={others().length > 0}>
                <h2 class="section-title">
                  <span>all</span>
                  <button class="section-add" onclick={() => setShowModal(true)} title="new project">+</button>
                </h2>
                <ProjectGrid projects={others()} onChange={onChange} />
              </Show>
            </>
          }
        >
          <h2 class="section-title"><span>results</span></h2>
          <Show when={results().length > 0} fallback={<div class="muted">no projects match "{query()}"</div>}>
            <ProjectGrid projects={results()} onChange={onChange} />
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
