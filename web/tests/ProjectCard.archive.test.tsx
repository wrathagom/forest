import { render, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, afterEach } from "vitest";
import { Router, Route } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";

const patchProject = vi.fn();
const refreshProject = vi.fn();

vi.mock("../src/api", () => ({
  patchProject: (...a: unknown[]) => patchProject(...a),
  refreshProject: (...a: unknown[]) => refreshProject(...a),
}));

afterEach(() => { patchProject.mockReset(); refreshProject.mockReset(); });

const base: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false,
  group: null, scannedAt: 0, liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: null, services: { docker: [], processes: [] }, errors: [],
  },
};

function renderCard(project: ProjectRow, onChange = () => {}) {
  return render(() => (
    <Router>
      <Route path="/" component={() => <ProjectCard project={project} onChange={onChange} />} />
    </Router>
  ));
}

describe("ProjectCard archive affordance", () => {
  test("visible card shows an archive button that hides the project", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const onChange = vi.fn();
    renderCard(base, onChange);
    fireEvent.click(screen.getByTitle("archive"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  test("hidden card shows an archived badge and a restore button that un-hides", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const archived: ProjectRow = { ...base, hidden: true };
    renderCard(archived);
    expect(screen.getByText("archived")).toBeTruthy();
    fireEvent.click(screen.getByTitle("restore"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: false }));
  });

  test("hidden card does not show pin or archive buttons", () => {
    renderCard({ ...base, hidden: true });
    expect(screen.queryByTitle("archive")).toBeNull();
    expect(screen.queryByTitle("pin")).toBeNull();
  });

  test("an archived project does not show the pinned star", () => {
    const { container } = renderCard({ ...base, pinned: true, hidden: true });
    expect(container.querySelector(".pin")).toBeNull();
    expect(screen.getByText("archived")).toBeTruthy();
  });
});
