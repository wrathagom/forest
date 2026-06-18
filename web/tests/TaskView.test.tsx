import { test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import TaskView from "../src/components/TaskView";

const getTaskDetail = vi.fn();
const patchTask = vi.fn();
const deleteTask = vi.fn();

vi.mock("../src/api", () => ({
  getTaskDetail: (...a: unknown[]) => getTaskDetail(...a),
  patchTask: (...a: unknown[]) => patchTask(...a),
  deleteTask: (...a: unknown[]) => deleteTask(...a),
}));

afterEach(() => { getTaskDetail.mockReset(); patchTask.mockReset(); deleteTask.mockReset(); });

const task = (over: Record<string, unknown>) => ({
  id: "t1", projectId: "p1", title: "A task", intent: "do the thing", status: "running",
  baseBranch: "main", branch: "task/a-task", worktreePath: "/p/.worktrees/a-task",
  sessionId: "sid-1", ptySessionId: "pty-1", result: null, resultRef: null,
  createdAt: 1, updatedAt: 1, launchedAt: 1, ...over,
});

test("renders the task header, intent, and meta", async () => {
  getTaskDetail.mockResolvedValue({ task: task({}), diff: null });
  const { container } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(container.textContent).toContain("A task"));
  expect(container.textContent).toContain("do the thing");
  expect(container.textContent).toContain("task/a-task");
});

test("shows the four completion actions for a review task and renders the diff", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: "+added line" });
  const { container, getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Merge to main")).toBeTruthy());
  expect(getByText("Open PR")).toBeTruthy();
  expect(getByText("Keep / detach")).toBeTruthy();
  expect(getByText("Discard")).toBeTruthy();
  expect(container.querySelector(".diff-add")).toBeTruthy();
});

test("clicking Merge to main calls patchTask with done/merged", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: null });
  patchTask.mockResolvedValue({ task: task({ status: "done", result: "merged" }) });
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Merge to main")).toBeTruthy());
  fireEvent.click(getByText("Merge to main"));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("t1", { status: "done", result: "merged" }),
  );
});

test("surfaces a PATCH error (e.g. merge conflict) in a banner", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: null });
  patchTask.mockRejectedValue(new Error("merge conflict"));
  const { getByText, container } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Merge to main")).toBeTruthy());
  fireEvent.click(getByText("Merge to main"));
  await waitFor(() => expect(container.querySelector(".banner-error")).toBeTruthy());
  expect(container.textContent).toContain("merge conflict");
});

test("a draft task shows a Launch action", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "draft", branch: null, sessionId: null }), diff: null });
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Launch")).toBeTruthy());
});

test("clicking the transcript link calls onOpenSession", async () => {
  getTaskDetail.mockResolvedValue({ task: task({}), diff: null });
  const onOpenSession = vi.fn();
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={onOpenSession} />
  ));
  await waitFor(() => expect(getByText("open transcript ↗")).toBeTruthy());
  fireEvent.click(getByText("open transcript ↗"));
  expect(onOpenSession).toHaveBeenCalledWith("sid-1", "A task");
});

test("a running task also shows the four completion actions", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "running" }), diff: null });
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Merge to main")).toBeTruthy());
  expect(getByText("Discard")).toBeTruthy();
});

test("a draft task's Delete button calls deleteTask and onClose", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "draft", branch: null, sessionId: null }), diff: null });
  deleteTask.mockResolvedValue(undefined);
  const onClose = vi.fn();
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} onClose={onClose} />
  ));
  await waitFor(() => expect(getByText("Delete")).toBeTruthy());
  fireEvent.click(getByText("Delete"));
  await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t1"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});
