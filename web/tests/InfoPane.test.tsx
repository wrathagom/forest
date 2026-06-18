import { test, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import InfoPane from "../src/components/InfoPane";

vi.mock("../src/api", () => ({
  fetchTree: vi.fn(async () => ({ entries: [] })),
  listTasks: vi.fn(async () => ({ tasks: [] })),
  createTask: vi.fn(async () => ({})),
  listSessions: vi.fn(async () => []),
  listAgentSessions: vi.fn(async () => []),
  fetchSessionsStats: vi.fn(async () => ({ stats: {} })),
  listProcessDetail: vi.fn(async () => []),
  listContainerDetail: vi.fn(async () => []),
}));

const noop = () => {};

beforeEach(() => {
  localStorage.clear();
});

test("renders nothing when not expanded", () => {
  const { container } = render(() => (
    <InfoPane
      projectId="p1"
      expanded={() => false}
      activeFilePath={() => null}
      onOpenFile={noop}
      onOpenDiff={noop}
      onOpenCommit={noop}
      onOpenSession={noop}
      onOpenTask={noop}
    />
  ));
  expect(container.querySelector(".info-pane")).toBeNull();
});

test("renders monitor, files, git, sessions tab labels", () => {
  const { container } = render(() => (
    <InfoPane
      projectId="p1"
      expanded={() => true}
      activeFilePath={() => null}
      onOpenFile={noop}
      onOpenDiff={noop}
      onOpenCommit={noop}
      onOpenSession={noop}
      onOpenTask={noop}
    />
  ));
  const labels = Array.from(container.querySelectorAll(".info-pane-tab")).map((b) => b.textContent);
  expect(labels).toEqual(["monitor", "files", "git", "sessions", "tasks"]);
});

test("legacy persisted tab 'processes' migrates to 'monitor'", () => {
  localStorage.setItem("forest.info.tab", JSON.stringify("processes"));
  const { container } = render(() => (
    <InfoPane
      projectId="p1"
      expanded={() => true}
      activeFilePath={() => null}
      onOpenFile={noop}
      onOpenDiff={noop}
      onOpenCommit={noop}
      onOpenSession={noop}
      onOpenTask={noop}
    />
  ));
  const active = container.querySelector(".info-pane-tab.active");
  expect(active?.textContent).toBe("monitor");
});

test("shows the tasks tab and renders TasksPanel when selected", async () => {
  const { getByText, container } = render(() => (
    <InfoPane
      projectId="p1"
      expanded={() => true}
      activeFilePath={() => null}
      onOpenFile={() => {}}
      onOpenDiff={() => {}}
      onOpenCommit={() => {}}
      onOpenSession={() => {}}
      onOpenTask={() => {}}
    />
  ));
  const tab = getByText("tasks");
  expect(tab).toBeTruthy();
  fireEvent.click(tab);
  await waitFor(() => expect(container.querySelector(".tasks-panel")).toBeTruthy());
});
