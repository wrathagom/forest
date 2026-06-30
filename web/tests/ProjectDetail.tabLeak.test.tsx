import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { Router, Route, useNavigate } from "@solidjs/router";
import { ProjectsContext } from "../src/projects-context";

// --- mock the data layer + heavy child components so the test stays focused on
//     tab-strip / per-project state, not xterm / codemirror / network. ---
const { listSessions, createSession, killSession, createWorktree, fetchConfig } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  killSession: vi.fn(),
  createWorktree: vi.fn(),
  fetchConfig: vi.fn(),
}));

vi.mock("../src/api", () => ({ listSessions, createSession, killSession, createWorktree, fetchConfig }));

vi.mock("../src/components/ProjectHeader", () => ({ default: () => <div data-stub="ProjectHeader" /> }));
vi.mock("../src/components/TerminalView", () => ({ default: () => <div data-stub="TerminalView" /> }));
vi.mock("../src/components/FileEditor", () => ({ default: () => <div data-stub="FileEditor" /> }));
vi.mock("../src/components/DiffView", () => ({ default: () => <div data-stub="DiffView" /> }));
vi.mock("../src/components/CommitView", () => ({ default: () => <div data-stub="CommitView" /> }));
vi.mock("../src/components/InfoPane", () => ({ default: () => <div data-stub="InfoPane" /> }));
vi.mock("../src/components/SessionTranscript", () => ({ default: () => <div data-stub="SessionTranscript" /> }));
vi.mock("../src/components/TaskView", () => ({ default: () => <div data-stub="TaskView" /> }));

import ProjectDetail from "../src/pages/ProjectDetail";

const projectsCtx = {
  projects: (() => ({
    projects: [
      { id: "alpha", name: "Alpha", path: "/repos/alpha" },
      { id: "beta", name: "Beta", path: "/repos/beta" },
    ],
  })) as never,
  refetch: () => {},
};

let navigate: (path: string) => void = () => {};
function Root(props: { children?: unknown }) {
  navigate = useNavigate();
  return props.children as never;
}

function renderApp() {
  return render(() => (
    <ProjectsContext.Provider value={projectsCtx}>
      <Router root={Root}>
        <Route path="/start" component={() => <div data-stub="start" />} />
        <Route path="/projects/:id" component={ProjectDetail} />
      </Router>
    </ProjectsContext.Provider>
  ));
}

const tabLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".tab-label")).map((n) => n.textContent?.trim());

beforeEach(() => {
  localStorage.clear();
  listSessions.mockReset().mockResolvedValue([]);
  createSession.mockReset();
  killSession.mockReset();
  createWorktree.mockReset();
  fetchConfig.mockReset().mockResolvedValue({ launchers: [] });
});

test("open file tabs do not follow you when switching projects", async () => {
  // alpha has two un-edited files open; beta has none.
  localStorage.setItem("forest.openFiles.alpha", JSON.stringify(["src/one.ts", "src/two.ts"]));

  const { container } = renderApp();
  navigate("/projects/alpha");
  await waitFor(() => expect(tabLabels(container)).toEqual(["one.ts", "two.ts"]));

  // Switch to beta — alpha's file tabs must not leak in.
  navigate("/projects/beta");
  await waitFor(() => expect(container.querySelector('[data-stub="ProjectHeader"]')).toBeTruthy());
  expect(tabLabels(container)).toEqual([]);

  // And beta's persisted file list must not have been clobbered with alpha's.
  expect(JSON.parse(localStorage.getItem("forest.openFiles.beta") ?? "[]")).toEqual([]);

  // Returning to alpha must still show alpha's own tabs (storage not corrupted).
  navigate("/projects/alpha");
  await waitFor(() => expect(tabLabels(container)).toEqual(["one.ts", "two.ts"]));
  expect(JSON.parse(localStorage.getItem("forest.openFiles.alpha") ?? "[]")).toEqual([
    "src/one.ts",
    "src/two.ts",
  ]);
});
