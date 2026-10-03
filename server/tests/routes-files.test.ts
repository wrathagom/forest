import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { upsertSnapshot } from "../src/store/snapshots";
import { startServer } from "../src/server";
import { projectFilesRoutes } from "../src/routes/files";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";

const db = openDb(":memory:");
const log = () => {};
const loop = createLoop({
  intervalMs: 60_000,
  listVisible: () => [],
  scanProject: async () => emptySnapshot(),
  onSnapshot: () => {},
  log,
});

let projRoot: string;
let pid: string;
let server: ReturnType<typeof startServer>;
let url: string;
const revealed: Array<{ abs: string; isDir: boolean }> = [];

const fileUrl = (path: string) =>
  `${url}/api/projects/${pid}/file?path=${encodeURIComponent(path)}`;
const rawUrl = (path: string) =>
  `${url}/api/projects/${pid}/file/raw?path=${encodeURIComponent(path)}`;

beforeAll(() => {
  projRoot = mkdtempSync(join(tmpdir(), "forest-files-route-"));

  // Small valid-enough PDF (classification only checks extension + size).
  writeFileSync(join(projRoot, "doc.pdf"), "%PDF-1.4\n%%EOF\n");

  // 3 MB PNG — over the 2 MB text limit, under the 50 MB media limit.
  writeFileSync(join(projRoot, "big.png"), "");
  truncateSync(join(projRoot, "big.png"), 3 * 1024 * 1024);

  // 51 MB PDF — over the 50 MB media limit.
  writeFileSync(join(projRoot, "huge.pdf"), "");
  truncateSync(join(projRoot, "huge.pdf"), 51 * 1024 * 1024);

  // 3 MB text file — over the 2 MB text limit.
  writeFileSync(join(projRoot, "big.txt"), "");
  truncateSync(join(projRoot, "big.txt"), 3 * 1024 * 1024);

  mkdirSync(join(projRoot, "sub"));

  pid = upsertProject(db, { path: projRoot, name: "filestest" });
  upsertSnapshot(db, pid, emptySnapshot());

  server = startServer({
    port: 0,
    db,
    loop,
    log,
    routes: [
      ...projectFilesRoutes({
        reveal: async (abs, isDir) => {
          revealed.push({ abs, isDir });
          return true;
        },
      }),
    ],
  });
  url = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(projRoot, { recursive: true, force: true });
});

describe("GET /file classification", () => {
  test("classifies a .pdf as kind pdf", async () => {
    const body = await (await fetch(fileUrl("doc.pdf"))).json();
    expect(body.kind).toBe("pdf");
    expect(body.path).toBe("doc.pdf");
    expect(typeof body.size).toBe("number");
    expect(typeof body.mtimeMs).toBe("number");
  });

  test("an image over the 2 MB text limit is still an image (under 50 MB)", async () => {
    const body = await (await fetch(fileUrl("big.png"))).json();
    expect(body.kind).toBe("image");
    expect(body.mime).toBe("image/png");
  });

  test("a PDF over the 50 MB media limit is too-large", async () => {
    const body = await (await fetch(fileUrl("huge.pdf"))).json();
    expect(body.kind).toBe("too-large");
  });

  test("a text file over the 2 MB limit is still too-large", async () => {
    const body = await (await fetch(fileUrl("big.txt"))).json();
    expect(body.kind).toBe("too-large");
  });
});

describe("GET /file/raw for PDFs", () => {
  test("serves application/pdf with hardening headers", async () => {
    const res = await fetch(rawUrl("doc.pdf"));
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
  });
});

describe("POST /reveal", () => {
  const revealUrl = (path: string) =>
    `${url}/api/projects/${pid}/reveal?path=${encodeURIComponent(path)}`;

  test("reveals a file by its absolute path", async () => {
    revealed.length = 0;
    const res = await fetch(revealUrl("doc.pdf"), { method: "POST" });
    expect(res.status).toBe(200);
    expect(revealed).toEqual([{ abs: join(projRoot, "doc.pdf"), isDir: false }]);
  });

  test("flags directories so they open rather than reveal", async () => {
    revealed.length = 0;
    const res = await fetch(revealUrl("sub"), { method: "POST" });
    expect(res.status).toBe(200);
    expect(revealed).toEqual([{ abs: join(projRoot, "sub"), isDir: true }]);
  });

  test("rejects paths escaping the project", async () => {
    revealed.length = 0;
    const res = await fetch(revealUrl("../etc"), { method: "POST" });
    expect(res.status).toBe(400);
    expect(revealed).toEqual([]);
  });

  test("404s a missing path", async () => {
    const res = await fetch(revealUrl("nope.txt"), { method: "POST" });
    expect(res.status).toBe(404);
  });
});
