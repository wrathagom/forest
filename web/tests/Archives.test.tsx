import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { Router, Route } from "@solidjs/router";
import Archives from "../src/pages/Archives";
import { setDashboardPreset } from "../src/lib/preferences";
import type { ProjectRow } from "../src/api";

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

function renderArchives() {
  return render(() => (
    <Router>
      <Route path="/" component={Archives} />
    </Router>
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
});
