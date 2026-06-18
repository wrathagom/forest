import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject, updateProject, hashPath } from "../src/store/projects";
import { setScanRoot, setPollIntervalMs } from "../src/store/config";
import { startServer } from "../src/server";
import { projectRoutes } from "../src/routes/projects";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";

const db = openDb(":memory:");
const log = () => {};

upsertProject(db, { path: "/proj/a", name: "a" });
const zId = upsertProject(db, { path: "/proj/z", name: "z" });
updateProject(db, zId, { hidden: true });
setScanRoot(db, "/proj");
setPollIntervalMs(db, 5000);

const loop = createLoop({
  intervalMs: 60_000,
  listVisible: () => [{ id: hashPath("/proj/a"), path: "/proj/a" }],
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

const names = async (qs: string): Promise<string[]> => {
  const res = await fetch(`${baseUrl}/api/projects${qs}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.projects.map((p: any) => p.name).sort();
};

describe("GET /api/projects?view=", () => {
  test("no param returns visible only", async () => {
    expect(await names("")).toEqual(["a"]);
  });
  test("view=archived returns hidden only", async () => {
    expect(await names("?view=archived")).toEqual(["z"]);
  });
  test("view=all returns both", async () => {
    expect(await names("?view=all")).toEqual(["a", "z"]);
  });
  test("unknown view value falls back to default", async () => {
    expect(await names("?view=bogus")).toEqual(["a"]);
  });
});
