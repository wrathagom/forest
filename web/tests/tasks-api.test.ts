import { test, expect, vi, afterEach } from "vitest";
import { listTasks, getTaskDetail, createTask, patchTask, deleteTask } from "../src/api";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ));
}

test("listTasks GETs the project tasks endpoint", async () => {
  mockFetch(200, { tasks: [{ id: "t1", status: "draft" }] });
  const r = await listTasks("p1");
  expect(r.tasks[0]!.id).toBe("t1");
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/projects/p1/tasks");
});

test("getTaskDetail GETs the task endpoint and returns task + diff", async () => {
  mockFetch(200, { task: { id: "t1" }, diff: "DIFF" });
  const r = await getTaskDetail("t1");
  expect(r.task.id).toBe("t1");
  expect(r.diff).toBe("DIFF");
});

test("createTask POSTs intent/baseBranch/status", async () => {
  mockFetch(201, { task: { id: "t9", status: "running" } });
  const r = await createTask("p1", { intent: "do it", baseBranch: "main", status: "running" });
  expect(r.task.id).toBe("t9");
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
  expect(call[0]).toBe("/api/projects/p1/tasks");
  expect(call[1]!.method).toBe("POST");
  expect(JSON.parse(call[1]!.body as string)).toEqual({ intent: "do it", baseBranch: "main", status: "running" });
});

test("patchTask PATCHes status/result", async () => {
  mockFetch(200, { task: { id: "t1", status: "done" } });
  await patchTask("t1", { status: "done", result: "merged" });
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
  expect(call[0]).toBe("/api/tasks/t1");
  expect(call[1]!.method).toBe("PATCH");
  expect(JSON.parse(call[1]!.body as string)).toEqual({ status: "done", result: "merged" });
});

test("patchTask throws the server error message on a 409", async () => {
  mockFetch(409, { error: "the main checkout has uncommitted changes" });
  await expect(patchTask("t1", { status: "done", result: "merged" })).rejects.toThrow(
    "uncommitted changes",
  );
});

test("deleteTask DELETEs the task endpoint", async () => {
  mockFetch(200, { ok: true });
  await deleteTask("t1");
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
  expect(call[0]).toBe("/api/tasks/t1");
  expect(call[1]!.method).toBe("DELETE");
});
