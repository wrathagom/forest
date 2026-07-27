import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { Router, Route } from "@solidjs/router";
import Archives from "../src/pages/Archives";
import { setDashboardPreset, setDashboardColorBy } from "../src/lib/preferences";
import type { ProjectRow } from "../src/api";
import { ProjectsContext } from "../src/projects-context";
import { THEME_BY_ID } from "../src/lib/themes/index";

const fetchProjects = vi.fn();
// Archives renders ProjectGrid -> ProjectCard, which imports patchProject and
// refreshProject from the same module — without mocking these too, the
// component blows up on an unrelated missing export.
const patchProject = vi.fn();
const refreshProject = vi.fn();

vi.mock("../src/api", () => ({
  fetchProjects: (...a: unknown[]) => fetchProjects(...a),
  patchProject: (...a: unknown[]) => patchProject(...a),
  refreshProject: (...a: unknown[]) => refreshProject(...a),
}));

// Archives reuses the dashboard's persisted preset/color-by rather than
// holding its own — pin it to "status" so the assertions below are stable
// regardless of what other tests (or a real browser session) left behind.
beforeEach(() => setDashboardPreset("status"));

afterEach(() => {
  fetchProjects.mockReset();
  patchProject.mockReset();
  refreshProject.mockReset();
});

const archivedProject: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: true,
  group: null, scannedAt: 0, liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: null, services: { docker: [], processes: [] }, errors: [],
  },
};

// Archives reads the visible-project list from the app-wide context so its
// group hues match the dashboard's. In the app that provider lives in App.tsx,
// which <Router root={App}> wraps around every route; here it has to be stood
// up by hand or useProjects() throws.
function renderArchives(visible: ProjectRow[] = []) {
  const projects = (() => ({ projects: visible, scanRoot: null, pollIntervalMs: 10_000 })) as never;
  return render(() => (
    <ProjectsContext.Provider value={{ projects, refetch: () => {} }}>
      <Router>
        <Route path="/" component={Archives} />
      </Router>
    </ProjectsContext.Provider>
  ));
}

describe("Archives", () => {
  test("an archived project renders a non-empty card body", async () => {
    fetchProjects.mockResolvedValue({
      projects: [archivedProject], scanRoot: null, pollIntervalMs: 10_000,
    });
    const { container } = renderArchives();

    // This is the assertion that catches an undefined `preset`: every one of
    // ProjectCard's three preset <Show> branches would be false, so the body
    // would be completely empty — no branch line, no chips.
    await waitFor(() => {
      expect(container.querySelector(".card-branch")?.textContent).toBe("main");
      expect(container.querySelector(".card-chips")).toBeTruthy();
      expect(container.querySelector(".card-chips")?.children.length).toBeGreaterThan(0);
    });
  });

  test("group hues account for visible projects, so they match the dashboard", async () => {
    // Group hue is the group's *index* into the group list, so the list has to
    // span the same projects the dashboard uses. Here "aaa" exists only among
    // visible projects and sorts first, which must push the archived "zzz"
    // project onto the second chart hue. Scoping the list to archived projects
    // alone would put "zzz" at index 0 and colour it differently here than on
    // the dashboard — the bug this guards.
    setDashboardColorBy("group");
    const visible: ProjectRow = { ...archivedProject, id: "vis", name: "vis", hidden: false, group: "aaa" };
    const archived: ProjectRow = { ...archivedProject, group: "zzz" };
    fetchProjects.mockResolvedValue({ projects: [archived], scanRoot: null, pollIntervalMs: 10_000 });

    const { container } = renderArchives([visible]);
    const theme = THEME_BY_ID["forest-dark"]!;

    await waitFor(() => {
      const band = container.querySelector(".card-band") as HTMLElement;
      expect(band).toBeTruthy();
      // index 1 of the chart palette, because "aaa" occupies index 0
      expect(band.style.getPropertyValue("--k")).toBe(theme.tokens.chart2);
    });
    setDashboardColorBy("git");
  });
});
