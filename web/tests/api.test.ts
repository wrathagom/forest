import { test, expect, vi, afterEach } from "vitest";
import { replyToSession, markSessionDone } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

const noContent = () => new Response(null, { status: 204 });

test("replyToSession resolves on a 204 No Content response", async () => {
  const fetchMock = vi.fn(async () => noContent());
  vi.stubGlobal("fetch", fetchMock);
  await expect(replyToSession("s1", "hello")).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith("/api/agent-sessions/s1/reply", expect.objectContaining({ method: "POST" }));
});

test("markSessionDone resolves on a 204 No Content response", async () => {
  const fetchMock = vi.fn(async () => noContent());
  vi.stubGlobal("fetch", fetchMock);
  await expect(markSessionDone("s1")).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith("/api/agent-sessions/s1/done", expect.objectContaining({ method: "POST" }));
});

test("markSessionDone throws with the server error message on a non-ok response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 400, headers: { "content-type": "application/json" } })));
  await expect(markSessionDone("s1")).rejects.toThrow("boom");
});

test("fetchTreeChildren requests the tree route with a path query param", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { fetchTreeChildren } = await import("../src/api");
  await expect(fetchTreeChildren("p1", ".worktrees/feat x")).resolves.toEqual({
    entries: [],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/projects/p1/tree?path=.worktrees%2Ffeat%20x",
  );
});

test("fileBlobUrl builds the git blob route with path and ref", async () => {
  const { fileBlobUrl } = await import("../src/api");
  expect(fileBlobUrl("p1", "assets/logo.png", "HEAD")).toBe(
    "/api/projects/p1/git/blob?path=assets%2Flogo.png&ref=HEAD",
  );
});
