import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Router, Route } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";

function renderCard(project: ProjectRow) {
  return render(() => (
    <Router>
      <Route path="/" component={() => <ProjectCard project={project} onChange={() => {}} />} />
    </Router>
  ));
}

const base: ProjectRow = {
  id: "abc",
  name: "demo",
  path: "/p",
  pinned: false,
  hidden: false,
  group: null,
  scannedAt: Date.now(),
  liveSessions: 0,
  liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: Date.now(),
    services: { docker: [], processes: [] },
    errors: [],
  },
};

describe("ProjectCard", () => {
  test("renders name, branch, and 'no services' fallback when snapshot is empty", () => {
    renderCard(base);
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("no services")).toBeTruthy();
  });

  test("shows error chip when snapshot.errors is non-empty", () => {
    const proj: ProjectRow = {
      ...base,
      snapshot: { ...base.snapshot!, errors: ["docker: docker unreachable"] },
    };
    const { container } = renderCard(proj);
    expect(container.querySelector(".dot-error")).toBeTruthy();
    expect(screen.getByText("docker: docker unreachable")).toBeTruthy();
  });

  test("shows changed-count when dirty", () => {
    const proj: ProjectRow = {
      ...base,
      snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git, dirty: true, changed: 4 } },
    };
    renderCard(proj);
    expect(screen.getByText("+4")).toBeTruthy();
  });

  test("renders the group tag when present", () => {
    const proj: ProjectRow = { ...base, group: "Personal" };
    renderCard(proj);
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  test("renders the terminals chip when liveSessions > 0", () => {
    const proj: ProjectRow = { ...base, liveSessions: 2 };
    renderCard(proj);
    expect(screen.getByText("2 terminals")).toBeTruthy();
  });

  test("renders aggregated listening ports as :N chips", () => {
    const proj: ProjectRow = {
      ...base,
      snapshot: {
        ...base.snapshot!,
        services: {
          docker: [],
          processes: [
            { pid: 100, command: "vite", cwd: "/p", ports: [5173, 3000] },
            { pid: 200, command: "bun", cwd: "/p", ports: [52810] },
          ],
        },
      },
    };
    renderCard(proj);
    expect(screen.getByText(":3000")).toBeTruthy();
    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":52810")).toBeTruthy();
  });

  test("renders 🤖 badge when liveAgents present", () => {
    const project: ProjectRow = { ...base, liveAgents: [{ agent: "claude", count: 2 }] };
    const { container } = renderCard(project);
    expect(container.textContent).toContain("🤖 2");
  });
});
