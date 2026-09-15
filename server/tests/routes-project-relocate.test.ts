import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db";
import { upsertProject, getProjectById, hashPath } from "../src/store/projects";
import { startServer } from "../src/server";
import { projectRoutes } from "../src/routes/projects";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";

const db = openDb(":memory:");
const log = () => {};
const dir = mkdtempSync(join(tmpdir(), "relocate-"));
const oldId = upsertProject(db, { path: "/repos/Sirdar", name: "sirdar" });

const loop = createLoop({
  intervalMs: 60_000,
  listVisible: () => [],
  scanProject: async () => emptySnapshot(),
  onSnapshot: () => {},
  log,
});

let server: ReturnType<typeof startServer>;
let baseUrl: string;

beforeAll(() => {
  server = startServer({ port: 0, db, loop, log, routes: projectRoutes() });
  baseUrl = `http://${server.hostname}:${server.port}`;
});
afterAll(() => server.stop());

const relocate = (id: string, path: unknown) =>
  fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/relocate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });

describe("POST /api/projects/:id/relocate", () => {
  test("404 for an unknown project", async () => {
    const res = await relocate("nope", dir);
    expect(res.status).toBe(404);
  });

  test("400 when path is missing", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${oldId}/relocate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("400 when path is not absolute", async () => {
    const res = await relocate(oldId, "relative/dir");
    expect(res.status).toBe(400);
  });

  test("400 when path does not exist", async () => {
    const res = await relocate(oldId, "/no/such/dir/anywhere");
    expect(res.status).toBe(400);
  });

  test("success returns the new id and moves the project", async () => {
    const res = await relocate(oldId, dir);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(hashPath(dir));
    expect(getProjectById(db, oldId)).toBeUndefined();
    expect(getProjectById(db, hashPath(dir))).toBeDefined();
  });

  test("409 when the target path is already a project", async () => {
    const other = upsertProject(db, { path: "/repos/other", name: "other" });
    // dir is now taken by the project moved above; relocating `other` there collides.
    const res = await relocate(other, dir);
    expect(res.status).toBe(409);
  });
});
