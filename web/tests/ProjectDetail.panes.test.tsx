import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import { Router, Route, useNavigate } from "@solidjs/router";
import { ProjectsContext } from "../src/projects-context";

// --- mock the data layer + heavy child components. Unlike tabLeak, we keep the
//     REAL InfoPane + FileTreePanel so we can click a file in the tree and drive
//     the true onOpenFile -> openFile path. The sibling info-pane panels are
//     stubbed so their api imports don't have to be mocked. ---
const {
  listSessions,
  createSession,
  killSession,
  createWorktree,
  fetchConfig,
  fetchTree,
  fetchTreeChildren,
} = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  killSession: vi.fn(),
  createWorktree: vi.fn(),
  fetchConfig: vi.fn(),
  fetchTree: vi.fn(),
  fetchTreeChildren: vi.fn(),
}));

vi.mock("../src/api", () => ({
  listSessions,
  createSession,
  killSession,
  createWorktree,
  fetchConfig,
  fetchTree,
  fetchTreeChildren,
}));

vi.mock("../src/components/ProjectHeader", () => ({ default: () => <div data-stub="ProjectHeader" /> }));
vi.mock("../src/components/TerminalView", () => ({ default: () => <div data-stub="TerminalView" /> }));
// FileEditor stub records its path so we can count how many editors exist per path.
vi.mock("../src/components/FileEditor", () => ({
  default: (p: { path: string }) => <div data-stub="FileEditor" data-path={p.path} />,
}));
vi.mock("../src/components/DiffView", () => ({ default: () => <div data-stub="DiffView" /> }));
vi.mock("../src/components/CommitView", () => ({ default: () => <div data-stub="CommitView" /> }));
vi.mock("../src/components/SessionTranscript", () => ({ default: () => <div data-stub="SessionTranscript" /> }));
vi.mock("../src/components/TaskView", () => ({ default: () => <div data-stub="TaskView" /> }));
// InfoPane + FileTreePanel are REAL. Its other panels are stubbed to avoid their api deps.
vi.mock("../src/components/MonitorPanel", () => ({ default: () => <div data-stub="MonitorPanel" /> }));
vi.mock("../src/components/GitPanel", () => ({ default: () => <div data-stub="GitPanel" /> }));
vi.mock("../src/components/SessionsPanel", () => ({ default: () => <div data-stub="SessionsPanel" /> }));
vi.mock("../src/components/TasksPanel", () => ({ default: () => <div data-stub="TasksPanel" /> }));

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

beforeEach(() => {
  localStorage.clear();
  listSessions.mockReset().mockResolvedValue([]);
  createSession.mockReset();
  killSession.mockReset();
  createWorktree.mockReset();
  fetchConfig.mockReset().mockResolvedValue({ launchers: [] });
  fetchTree.mockReset().mockResolvedValue({
    entries: [
      { path: "a.ts", type: "file", gitStatus: null },
      { path: "b.ts", type: "file", gitStatus: null },
    ],
  });
  fetchTreeChildren.mockReset().mockResolvedValue({ entries: [] });
});

test("normal-clicking the pinned file never mounts two editors for it", async () => {
  // a.ts active on the left, b.ts pinned on the right, info pane open on files.
  localStorage.setItem("forest.openFiles.alpha", JSON.stringify(["a.ts", "b.ts"]));
  localStorage.setItem("forest.activeTab.alpha", JSON.stringify("file:a.ts"));
  localStorage.setItem("forest.secondaryTab.alpha", JSON.stringify("file:b.ts"));
  localStorage.setItem("forest.info.expanded", JSON.stringify(true));
  localStorage.setItem("forest.info.tab", JSON.stringify("files"));

  const { container } = renderApp();
  navigate("/projects/alpha");

  // Split is live: b.ts pinned right, a.ts active left — exactly one editor each.
  await waitFor(() => expect(container.querySelector(".terminal-area.split")).toBeTruthy());
  const editorsFor = (p: string) =>
    container.querySelectorAll(`[data-stub="FileEditor"][data-path="${p}"]`).length;
  expect(editorsFor("a.ts")).toBe(1);
  expect(editorsFor("b.ts")).toBe(1);

  // Wait for the real file tree to render, then normal-click the pinned file b.ts.
  const treeRow = (name: string) =>
    Array.from(container.querySelectorAll(".file-tree .tree-file")).find(
      (r) => r.querySelector(".tree-file-name")?.textContent === name,
    );
  await waitFor(() => expect(treeRow("b.ts")).toBeTruthy());
  fireEvent.click(treeRow("b.ts")!);

  // Regression: openFile must not produce a second CodeMirror view on b.ts.
  // With the bug (openFile calls setActiveId directly) activeId === secondaryId
  // === "file:b.ts" and BOTH panes mount an editor for it -> editorsFor === 2.
  await waitFor(() => expect(editorsFor("b.ts")).toBe(1));

  // Selecting the pinned file brings it back to the left and closes the split.
  expect(container.querySelector(".terminal-area.split")).toBeNull();
  // The persisted invariant activeId !== secondaryId must hold.
  expect(localStorage.getItem("forest.activeTab.alpha")).toBe(JSON.stringify("file:b.ts"));
  expect(localStorage.getItem("forest.secondaryTab.alpha")).toBe(JSON.stringify(null));
});
