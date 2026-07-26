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
      <Route path="/" component={() => (
        <ProjectCard
          project={project}
          preset="status"
          colorBy="git"
          groups={[]}
          onChange={onChange}
        />
      )} />
    </Router>
  ));
}

/** Actions live behind the menu now, so every interaction opens it first. */
function openMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement);
}

describe("ProjectCard archive affordance", () => {
  test("visible card offers archive, which hides the project", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const onChange = vi.fn();
    const { container } = renderCard(base, onChange);
    openMenu(container);
    fireEvent.click(screen.getByText("archive"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  test("hidden card shows an archived tag and offers restore, which un-hides", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const { container } = renderCard({ ...base, hidden: true });
    expect(screen.getByText("archived")).toBeTruthy();
    openMenu(container);
    fireEvent.click(screen.getByText("restore"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { hidden: false }));
  });

  test("hidden card offers neither archive nor pin", () => {
    const { container } = renderCard({ ...base, hidden: true });
    openMenu(container);
    expect(screen.queryByText("archive")).toBeNull();
    expect(screen.queryByText("pin")).toBeNull();
    expect(screen.queryByText("unpin")).toBeNull();
  });

  test("an archived project shows no pinned star anywhere", () => {
    const { container } = renderCard({ ...base, pinned: true, hidden: true });
    expect(container.querySelector(".pin")).toBeNull();
    expect(screen.getByText("archived")).toBeTruthy();
  });

  test("visible card offers pin, which pins the project", async () => {
    patchProject.mockResolvedValue({ ok: true });
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("pin"));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("abc", { pinned: true }));
  });

  test("refresh calls the refresh endpoint", async () => {
    refreshProject.mockResolvedValue({ ok: true });
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(refreshProject).toHaveBeenCalledWith("abc"));
  });
});
