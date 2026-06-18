import { createResource, onCleanup, Show } from "solid-js";
import { A, useLocation, type RouteSectionProps } from "@solidjs/router";
import { fetchProjects } from "./api";
import { ProjectsContext } from "./projects-context";
import { autoRefresh } from "./lib/preferences";
import SessionBar from "./components/SessionBar";
import CaffeinateButton from "./components/CaffeinateButton";

export default function App(props: RouteSectionProps) {
  const [projects, { refetch }] = createResource(() => fetchProjects());
  const loc = useLocation();
  const bare = () => loc.pathname === "/m" || loc.pathname.startsWith("/m/");

  const interval = setInterval(() => {
    if (autoRefresh() && !document.hidden) refetch();
  }, 5000);
  onCleanup(() => clearInterval(interval));

  return (
    <ProjectsContext.Provider value={{ projects, refetch }}>
      <Show when={!bare()} fallback={props.children}>
        <div class="app">
          <header class="app-header">
            <A href="/" class="app-brand"><span class="brand-mark">ƒ</span>orest</A>
            <nav class="app-nav">
              <A href="/sessions" class="nav-link">sessions</A>
              <A href="/archives" class="nav-link">archives</A>
              <A href="/settings" class="nav-link">settings</A>
              <CaffeinateButton />
            </nav>
          </header>
          <Show when={projects.error}>
            <div class="banner banner-error">
              failed to load projects: {(projects.error as Error)?.message ?? "unknown error"}
            </div>
          </Show>
          <main class="app-main">
            {props.children}
          </main>
          <SessionBar />
        </div>
      </Show>
    </ProjectsContext.Provider>
  );
}
