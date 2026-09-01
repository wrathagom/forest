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

const DIFF_TWO_FILES = [
  "diff --git a/web/src/a.ts b/web/src/a.ts",
  "--- a/web/src/a.ts",
  "+++ b/web/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -0,0 +1 @@",
  "+hello",
].join("\n");

test("renders the task header, intent, and meta", async () => {
  getTaskDetail.mockResolvedValue({ task: task({}), diff: null });
  const { container } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(container.textContent).toContain("A task"));
  expect(container.textContent).toContain("do the thing");
  expect(container.textContent).toContain("task/a-task");
});

test("shows the four completion actions for a review task", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: null });
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Merge to main")).toBeTruthy());
  expect(getByText("Open PR")).toBeTruthy();
  expect(getByText("Keep / detach")).toBeTruthy();
  expect(getByText("Discard")).toBeTruthy();
});

test("renders one collapsed row per file, expandable on click", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: DIFF_TWO_FILES });
  const { container, getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("web/src/a.ts")).toBeTruthy());
  expect(getByText("README.md")).toBeTruthy();
  expect(container.querySelectorAll(".diff-file").length).toBe(2);
  expect(container.querySelector(".diff-add")).toBeNull(); // collapsed => no diff lines

  fireEvent.click(getByText("web/src/a.ts"));
  await waitFor(() => expect(container.querySelector(".diff-add")).toBeTruthy());
});

test("expand all reveals every file's diff; collapse all hides them", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: DIFF_TWO_FILES });
  const { container, getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("web/src/a.ts")).toBeTruthy());
  fireEvent.click(getByText("expand all"));
  await waitFor(() => expect(container.querySelectorAll(".diff-file.open").length).toBe(2));
  fireEvent.click(getByText("collapse all"));
  await waitFor(() => expect(container.querySelectorAll(".diff-file.open").length).toBe(0));
});

test("shows per-file +/− counts and an aggregate summary", async () => {
  getTaskDetail.mockResolvedValue({ task: task({ status: "review" }), diff: DIFF_TWO_FILES });
  const { container, getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("web/src/a.ts")).toBeTruthy());
  const adds = Array.from(container.querySelectorAll(".diff-file-add")).map((e) => e.textContent);
  const dels = Array.from(container.querySelectorAll(".diff-file-del")).map((e) => e.textContent);
  expect(adds).toEqual(["+1", "+1"]);
  expect(dels[0]).toContain("1");
  expect(dels[1]).toContain("0");
  expect(container.querySelector(".diff-changes-label")!.textContent).toContain("2 files");
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

test("merged task shows the banner and a single Complete & clean up action", async () => {
  getTaskDetail.mockResolvedValue({
    task: task({ status: "review" }), diff: null, mergedIntoBase: true,
  });
  const { getByText, queryByText, container } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Complete & clean up")).toBeTruthy());
  expect(container.textContent).toContain("Already merged into main");
  expect(getByText("Keep / detach")).toBeTruthy();
  expect(getByText("Discard")).toBeTruthy();
  expect(queryByText("Merge to main")).toBeNull();
  expect(queryByText("Open PR")).toBeNull();
});

test("Complete & clean up calls patchTask with done/merged", async () => {
  getTaskDetail.mockResolvedValue({
    task: task({ status: "review" }), diff: null, mergedIntoBase: true,
  });
  patchTask.mockResolvedValue({ task: task({ status: "done", result: "merged" }) });
  const { getByText } = render(() => (
    <TaskView taskId="t1" visible={true} onOpenSession={vi.fn()} />
  ));
  await waitFor(() => expect(getByText("Complete & clean up")).toBeTruthy());
  fireEvent.click(getByText("Complete & clean up"));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("t1", { status: "done", result: "merged" }),
  );
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
