import { render, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, afterEach } from "vitest";
import { Router, Route } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";

const patchProject = vi.fn();
const refreshProject = vi.fn();
const relocateProject = vi.fn();

vi.mock("../src/api", () => ({
  patchProject: (...a: unknown[]) => patchProject(...a),
  refreshProject: (...a: unknown[]) => refreshProject(...a),
  relocateProject: (...a: unknown[]) => relocateProject(...a),
}));

afterEach(() => {
  patchProject.mockReset();
  refreshProject.mockReset();
  relocateProject.mockReset();
  vi.unstubAllGlobals();
});

const base: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false,
  group: null, scannedAt: 0, liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: null, services: { docker: [], processes: [] }, errors: [],
    lifecycle: { status: "none", hasConfig: false, enabled: false, health: null },
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

describe("ProjectCard relocate affordance", () => {
  test("cancelling the prompt (null) does not call relocateProject", async () => {
    vi.stubGlobal("prompt", vi.fn(() => null));
    const onChange = vi.fn();
    const { container } = renderCard(base, onChange);
    openMenu(container);
    fireEvent.click(screen.getByText("relocate…"));
    await Promise.resolve();
    expect(relocateProject).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an empty (whitespace-only) prompt reply does not call relocateProject", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "   "));
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("relocate…"));
    await Promise.resolve();
    expect(relocateProject).not.toHaveBeenCalled();
  });

  test("replying with the unchanged path does not call relocateProject", async () => {
    vi.stubGlobal("prompt", vi.fn(() => base.path));
    const { container } = renderCard(base);
    openMenu(container);
    fireEvent.click(screen.getByText("relocate…"));
    await Promise.resolve();
    expect(relocateProject).not.toHaveBeenCalled();
  });

  test("a new path is trimmed and passed to relocateProject, then onChange fires", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "  /new/path  "));
    relocateProject.mockResolvedValue({ ok: true, id: "abc" });
    const onChange = vi.fn();
    const { container } = renderCard(base, onChange);
    openMenu(container);
    fireEvent.click(screen.getByText("relocate…"));
    await waitFor(() => expect(relocateProject).toHaveBeenCalledWith("abc", "/new/path"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  test("a rejected relocate alerts the error message and does not call onChange", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "/new/path"));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    relocateProject.mockRejectedValue(new Error("boom"));
    const onChange = vi.fn();
    const { container } = renderCard(base, onChange);
    openMenu(container);
    fireEvent.click(screen.getByText("relocate…"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("boom"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
