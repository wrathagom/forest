import { test, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";

vi.mock("../src/api", () => ({
  fetchTree: vi.fn(),
  fetchTreeChildren: vi.fn(),
  listTasks: vi.fn(async () => ({ tasks: [] })),
  createTask: vi.fn(async () => ({})),
  listSessions: vi.fn(async () => []),
  listAgentSessions: vi.fn(async () => []),
  fetchSessionsStats: vi.fn(async () => ({ stats: {} })),
  listProcessDetail: vi.fn(async () => []),
  listContainerDetail: vi.fn(async () => []),
}));

import InfoPane from "../src/components/InfoPane";
import { fetchTree, fetchTreeChildren } from "../src/api";
import type { TreeEntry } from "../src/api";

const mockTree = vi.mocked(fetchTree);
const mockChildren = vi.mocked(fetchTreeChildren);

const TREES: Record<string, TreeEntry[]> = {
  p1: [
    { path: "shared.ts", type: "file", size: 10, gitStatus: null },
    { path: "only-in-p1.md", type: "file", size: 20, gitStatus: "?" },
    { path: "ignored", type: "dir", size: null, gitStatus: "!" },
  ],
  p2: [
    { path: "shared.ts", type: "file", size: 10, gitStatus: null },
    { path: "only-in-p2.md", type: "file", size: 20, gitStatus: "?" },
  ],
};

beforeEach(() => {
  localStorage.clear();
  mockTree.mockReset();
  mockChildren.mockReset();
  mockTree.mockImplementation(async (id: string) => ({ entries: TREES[id] ?? [] }));
  mockChildren.mockImplementation(async (_id: string, path: string) => ({
    entries: [
      { path: `${path}/p1-ignored-child.txt`, type: "file", size: 1, gitStatus: "!" },
    ] as TreeEntry[],
  }));
});

const noop = () => {};

function renderPane() {
  const [projectId, setProjectId] = createSignal("p1");
  render(() => (
    <InfoPane
      projectId={projectId()}
      expanded={() => true}
      highlightedPaths={() => []}
      onOpenFile={noop}
      onOpenDiff={noop}
      onOpenFileRight={noop}
      onOpenCommit={noop}
      onOpenSession={noop}
      onOpenTask={noop}
    />
  ));
  fireEvent.click(screen.getByText("files"));
  return { setProjectId };
}

test("switching projects drops the previous project's untracked files", async () => {
  const { setProjectId } = renderPane();
  await waitFor(() => expect(screen.getByText("only-in-p1.md")).toBeTruthy());

  setProjectId("p2");

  await waitFor(() => expect(screen.getByText("only-in-p2.md")).toBeTruthy());
  expect(screen.queryByText("only-in-p1.md")).toBeNull();
});

test("the previous project's tree is not shown while the new one loads", async () => {
  let release!: (entries: TreeEntry[]) => void;
  const { setProjectId } = renderPane();
  await waitFor(() => expect(screen.getByText("only-in-p1.md")).toBeTruthy());

  mockTree.mockImplementationOnce(
    () => new Promise((resolve) => { release = (entries) => resolve({ entries }); }),
  );
  setProjectId("p2");

  // p2 is still in flight — we must not be rendering p1's files under p2.
  await waitFor(() => expect(screen.queryByText("only-in-p1.md")).toBeNull());
  release(TREES.p2!);
  await waitFor(() => expect(screen.getByText("only-in-p2.md")).toBeTruthy());
});

test("switching projects drops children lazily loaded from the previous project", async () => {
  const { setProjectId } = renderPane();
  await waitFor(() => expect(screen.getByText(/ignored/)).toBeTruthy());
  fireEvent.click(screen.getByText(/^[▸▾]\s+ignored$/));
  await waitFor(() => expect(screen.getByText("p1-ignored-child.txt")).toBeTruthy());

  setProjectId("p2");

  await waitFor(() => expect(screen.getByText("only-in-p2.md")).toBeTruthy());
  expect(screen.queryByText("p1-ignored-child.txt")).toBeNull();
});
