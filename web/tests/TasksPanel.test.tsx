import { test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import TasksPanel from "../src/components/TasksPanel";

const listTasks = vi.fn();
const createTask = vi.fn();

vi.mock("../src/api", () => ({
  listTasks: (...a: unknown[]) => listTasks(...a),
  createTask: (...a: unknown[]) => createTask(...a),
}));

afterEach(() => { listTasks.mockReset(); createTask.mockReset(); });

const task = (over: Record<string, unknown>) => ({
  id: "t1", projectId: "p1", title: "A task", intent: "do it", status: "draft",
  baseBranch: "main", branch: null, worktreePath: null, sessionId: null,
  ptySessionId: null, result: null, resultRef: null,
  createdAt: 1, updatedAt: 1, launchedAt: null, ...over,
});

test("renders tasks grouped into status buckets", async () => {
  listTasks.mockResolvedValue({ tasks: [
    task({ id: "r1", title: "Review me", status: "review" }),
    task({ id: "g1", title: "Going", status: "running" }),
    task({ id: "d1", title: "Draft one", status: "draft" }),
  ]});
  const { container } = render(() => (
    <TasksPanel projectId="p1" enabled={() => true} onOpenTask={vi.fn()} />
  ));
  await waitFor(() => expect(container.textContent).toContain("Review me"));
  expect(container.textContent).toContain("Needs you");
  expect(container.textContent).toContain("Running");
  expect(container.textContent).toContain("Draft");
});

test("clicking a task row calls onOpenTask with the task id", async () => {
  listTasks.mockResolvedValue({ tasks: [task({ id: "t7", title: "Clickme" })] });
  const onOpenTask = vi.fn();
  const { container } = render(() => (
    <TasksPanel projectId="p1" enabled={() => true} onOpenTask={onOpenTask} />
  ));
  await waitFor(() => expect(container.querySelector(".tasks-row")).toBeTruthy());
  fireEvent.click(container.querySelector(".tasks-row")!);
  expect(onOpenTask).toHaveBeenCalledWith("t7", "Clickme");
});

test("the composer launches a task and refreshes the list", async () => {
  listTasks.mockResolvedValue({ tasks: [] });
  createTask.mockResolvedValue({ task: task({}) });
  const { container, getByText, getByPlaceholderText } = render(() => (
    <TasksPanel projectId="p1" enabled={() => true} onOpenTask={vi.fn()} />
  ));
  await waitFor(() => expect(container.textContent).toContain("no tasks yet"));
  fireEvent.click(getByText("+ New Task"));
  fireEvent.input(getByPlaceholderText("what are you trying to do?"), {
    target: { value: "Add rate limiting" },
  });
  fireEvent.click(getByText("Launch"));
  await waitFor(() =>
    expect(createTask).toHaveBeenCalledWith("p1", {
      intent: "Add rate limiting", baseBranch: undefined, status: "running",
    }),
  );
});

test("renders status buckets in order: Needs you, Running, Draft, Done", async () => {
  listTasks.mockResolvedValue({ tasks: [
    task({ id: "d1", title: "Draft one", status: "draft" }),
    task({ id: "x1", title: "Done one", status: "done", result: "merged" }),
    task({ id: "r1", title: "Review me", status: "review" }),
    task({ id: "g1", title: "Going", status: "running" }),
  ]});
  const { container } = render(() => (
    <TasksPanel projectId="p1" enabled={() => true} onOpenTask={vi.fn()} />
  ));
  await waitFor(() => expect(container.querySelector(".tasks-bucket-label")).toBeTruthy());
  const labels = [...container.querySelectorAll(".tasks-bucket-label")].map((el) => el.textContent ?? "");
  expect(labels[0]).toContain("Needs you");
  expect(labels[1]).toContain("Running");
  expect(labels[2]).toContain("Draft");
  expect(labels[3]).toContain("Done");
});
