import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject, hashPath } from "../src/store/projects";
import { upsertSnapshot } from "../src/store/snapshots";
import { setScanRoot, setPollIntervalMs } from "../src/store/config";
import { startServer } from "../src/server";
import { projectRoutes } from "../src/routes/projects";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";
import { makeLogger } from "../src/log";

let server: ReturnType<typeof startServer>;
let baseUrl: string;
const db = openDb(":memory:");
const log = () => {};

const aId = upsertProject(db, { path: "/proj/a", name: "a" });
const bId = upsertProject(db, { path: "/proj/b", name: "b" });
upsertSnapshot(db, aId, emptySnapshot());
setScanRoot(db, "/proj");
setPollIntervalMs(db, 5000);

const loop = createLoop({
  intervalMs: 60_000,
  listVisible: () => [
    { id: aId, path: "/proj/a" },
    { id: bId, path: "/proj/b" },
  ],
  scanProject: async () => emptySnapshot(),
  onSnapshot: (id, snap) => upsertSnapshot(db, id, snap),
  log,
});

beforeAll(() => {
  server = startServer({ port: 0, db, loop, log, routes: projectRoutes() });
  baseUrl = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  server.stop();
});

describe("GET /api/projects", () => {
  test("returns visible projects with their latest snapshot and config", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanRoot).toBe("/proj");
    expect(body.pollIntervalMs).toBe(5000);
    const ids = body.projects.map((p: any) => p.id).sort();
    expect(ids).toEqual([aId, bId].sort());
    const a = body.projects.find((p: any) => p.id === aId);
    expect(a.snapshot.git.branch).toBe(null);
  });
});

describe("GET /api/projects/:id", () => {
  test("returns 404 for unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/projects/nope`);
    expect(res.status).toBe(404);
  });

  test("returns the project for a known id", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${aId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(aId);
  });
});

describe("POST /api/projects/:id/refresh", () => {
  test("returns the fresh snapshot from the loop", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${aId}/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(aId);
    expect(body.snapshot).toBeDefined();
  });

  test("returns 404 for an unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/projects/nope/refresh`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:id", () => {
  test("toggles pinned and reflects on next list", async () => {
    const r1 = await fetch(`${baseUrl}/api/projects/${aId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(r1.status).toBe(200);
    const list = await (await fetch(`${baseUrl}/api/projects`)).json();
    const a = list.projects.find((p: any) => p.id === aId);
    expect(a.pinned).toBe(true);
  });

  test("rejects non-JSON body with 400", async () => {
    const r = await fetch(`${baseUrl}/api/projects/${aId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(r.status).toBe(400);
  });
});

import { mkdtempSync, mkdirSync, existsSync, writeFileSync as wf, writeFileSync } from "node:fs";
import { createHash as ch } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configRoutes } from "../src/routes/config";
import { discoverRoutes } from "../src/routes/discover";
import { healthRoutes } from "../src/routes/health";
import { sessionRoutes } from "../src/routes/sessions";
import { SessionRegistry } from "../src/sessions/registry";
import { makeFakePtyFactory } from "./helpers/fakePty";
import type { AgentDetector } from "../src/sessions/agent-detect";

describe("config + health + discover", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;
  let lastDiscoverRoot: string | null = null;
  const realRoot = mkdtempSync(join(tmpdir(), "forest-config-"));

  beforeAll(() => {
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [
        ...projectRoutes(),
        ...configRoutes({ claudeConfigDirs: () => [] }),
        ...discoverRoutes({
          runDiscover: async (root) => {
            lastDiscoverRoot = root;
            return [];
          },
        }),
        ...healthRoutes({ dockerReachable: async () => true }),
      ],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop());

  test("GET /api/config returns scanRoot and pollIntervalMs", async () => {
    const r = await fetch(`${url}/api/config`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.scanRoot).toBe("/proj");
    expect(body.pollIntervalMs).toBe(5000);
  });

  test("PATCH /api/config sets scanRoot to a real directory", async () => {
    const r = await fetch(`${url}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanRoot: realRoot }),
    });
    expect(r.status).toBe(200);
    const r2 = await fetch(`${url}/api/config`);
    expect((await r2.json()).scanRoot).toBe(realRoot);
  });

  test("PATCH /api/config rejects a non-existent directory", async () => {
    const r = await fetch(`${url}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanRoot: "/this/path/does/not/exist/forest-test" }),
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/discover invokes runDiscover with current scanRoot", async () => {
    const r = await fetch(`${url}/api/discover`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(lastDiscoverRoot).toBe(realRoot);
  });

  test("GET /api/health returns ok with dockerReachable", async () => {
    const r = await fetch(`${url}/api/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.dockerReachable).toBe(true);
  });

  test("GET /api/config returns projectSubdirs (default empty)", async () => {
    const r = await fetch(`${url}/api/config`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.projectSubdirs).toEqual([]);
  });

  test("PATCH /api/config sets projectSubdirs", async () => {
    const r = await fetch(`${url}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSubdirs: ["Personal", "Professional"] }),
    });
    expect(r.status).toBe(200);
    const r2 = await fetch(`${url}/api/config`);
    expect((await r2.json()).projectSubdirs).toEqual(["Personal", "Professional"]);
  });
});

describe("session routes", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;
  let registry: SessionRegistry;

  beforeAll(() => {
    const { factory } = makeFakePtyFactory();
    registry = new SessionRegistry({
      pty: factory,
      maxTotal: 2,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 1,
      exitRetentionMs: 100,
    });
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...sessionRoutes(registry)],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop());

  test("POST /api/projects/:id/sessions creates a session at the project's path", async () => {
    const r = await fetch(`${url}/api/projects/${aId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.projectId).toBe(aId);
    expect(body.cwd).toBe("/proj/a");
    expect(typeof body.id).toBe("string");
  });

  test("POST 404 for unknown project", async () => {
    const r = await fetch(`${url}/api/projects/missing/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(r.status).toBe(404);
  });

  test("POST 429 when at session cap", async () => {
    await fetch(`${url}/api/projects/${aId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    const r = await fetch(`${url}/api/projects/${aId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(r.status).toBe(429);
  });

  test("GET /api/projects/:id/sessions lists this project's sessions", async () => {
    const r = await fetch(`${url}/api/projects/${aId}/sessions`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.every((row: any) => row.projectId === aId)).toBe(true);
  });

  test("DELETE /api/sessions/:sid kills the session", async () => {
    const sessions = registry.listByProject(aId);
    const target = sessions[0]!;
    const r = await fetch(`${url}/api/sessions/${target.id}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    expect(registry.get(target.id)).toBeUndefined();
  });

  test("DELETE 404 for unknown session id", async () => {
    const r = await fetch(`${url}/api/sessions/nope`, { method: "DELETE" });
    expect(r.status).toBe(404);
  });

  test("POST with command=claude (no launcherId) tags the session as agent=claude", async () => {
    const r = await fetch(`${url}/api/projects/${aId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24, command: "claude", args: ["--resume", "sid-x"] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.agent).toBe("claude");
    expect(body.launcher).toEqual({ id: "implicit-claude", agent: "claude" });
  });

  test("GET sessions: agent falls back to detector, launcher tag still wins", async () => {
    const fakeDetector = { get: () => "codex" } as unknown as AgentDetector;
    const s2 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...sessionRoutes(registry, fakeDetector)],
    });
    try {
      const r = await fetch(`http://${s2.hostname}:${s2.port}/api/projects/${aId}/sessions`);
      const body = await r.json();
      // launcher-less session → detector fallback supplies the agent
      expect(body.some((row: any) => row.agent === "codex")).toBe(true);
      // command=claude session → launcher tag wins over the detector
      expect(body.some((row: any) => row.agent === "claude")).toBe(true);
    } finally {
      s2.stop();
    }
  });
});

describe("WebSocket attach", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;
  let registry: SessionRegistry;
  let instances: ReturnType<typeof makeFakePtyFactory>["instances"];

  beforeAll(() => {
    const f = makeFakePtyFactory();
    instances = f.instances;
    registry = new SessionRegistry({
      pty: f.factory,
      maxTotal: 4,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 1,
      exitRetentionMs: 100,
    });
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      sessions: registry,
      routes: [...projectRoutes(), ...sessionRoutes(registry)],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop(true));

  test("upgrade replays scrollback then streams output", async () => {
    const created = registry.create({
      projectId: aId,
      cwd: "/proj/a",
      cols: 80,
      rows: 24,
    });
    instances[instances.length - 1]!.emitData("seed-line\r\n");
    // Wait for the coalesce timer (1ms) to flush before attaching so seed-line
    // ends up only in scrollback and not also broadcast as an output frame.
    await new Promise((r) => setTimeout(r, 20));

    const ws = new WebSocket(`ws://${s.hostname}:${s.port}/ws/projects/${aId}/sessions/${created.id}`);
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {};
      ws.onmessage = (ev) => {
        messages.push(String(ev.data));
        if (messages.length === 2) resolve();
      };
      ws.onerror = (e) => reject(e);
      setTimeout(() => {
        instances[instances.length - 1]!.emitData("after-attach\r\n");
      }, 30);
      setTimeout(() => reject(new Error("ws timeout")), 1000);
    });

    expect(messages[0]).toContain("scrollback");
    expect(messages[0]).toContain("seed-line");
    expect(messages[1]).toContain("output");
    expect(messages[1]).toContain("after-attach");
    ws.close();
  });
});

import { projectInfoRoutes } from "../src/routes/project-info";

describe("project-info routes", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;

  beforeAll(() => {
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [
        ...projectRoutes(),
        ...projectInfoRoutes({
          processes: async (path) => [
            {
              pid: 42,
              ppid: 1,
              command: "bun run dev",
              cwd: path,
              user: "alice",
              cpu: 3.4,
              memMB: 142,
              startedAt: 1_700_000_000_000,
              ports: [5173],
            },
          ],
          containers: async () => [
            {
              service: "db",
              state: "running",
              containerName: "demo-db-1",
              image: "postgres:16",
              ports: [{ host: "0.0.0.0", container: 5432, protocol: "tcp" }],
              startedAt: 1_700_000_000_000,
              exitCode: 0,
              health: "healthy",
            },
          ],
        }),
      ],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop(true));

  test("GET /api/projects/:id/processes returns the detail array", async () => {
    const r = await fetch(`${url}/api/projects/${aId}/processes`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].pid).toBe(42);
    expect(body[0].cpu).toBe(3.4);
  });

  test("GET /api/projects/:id/processes 404s for unknown project", async () => {
    const r = await fetch(`${url}/api/projects/missing/processes`);
    expect(r.status).toBe(404);
  });

  test("GET /api/projects/:id/containers returns the detail array", async () => {
    const r = await fetch(`${url}/api/projects/${aId}/containers`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].service).toBe("db");
    expect(body[0].image).toBe("postgres:16");
  });

  test("GET /api/projects/:id/containers 404s for unknown project", async () => {
    const r = await fetch(`${url}/api/projects/missing/containers`);
    expect(r.status).toBe(404);
  });
});

describe("liveSessions in projects payload", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;
  let registry: SessionRegistry;

  beforeAll(() => {
    const { factory } = makeFakePtyFactory();
    registry = new SessionRegistry({
      pty: factory,
      maxTotal: 4,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 1,
      exitRetentionMs: 100,
    });
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      sessions: registry,
      routes: [...projectRoutes(registry), ...sessionRoutes(registry)],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop(true));

  test("count goes up after creating a session", async () => {
    const before = await (await fetch(`${url}/api/projects`)).json();
    const aBefore = before.projects.find((p: any) => p.id === aId).liveSessions;
    registry.create({ projectId: aId, cwd: "/proj/a", cols: 80, rows: 24 });
    const after = await (await fetch(`${url}/api/projects`)).json();
    const aAfter = after.projects.find((p: any) => p.id === aId).liveSessions;
    expect(aAfter).toBe(aBefore + 1);
  });
});

import { projectCreateRoutes } from "../src/routes/projects-create";
import { setProjectSubdirs } from "../src/store/config";
import type { RunGit } from "../src/git";
import { projectFilesRoutes } from "../src/routes/files";

describe("POST /api/projects", () => {
  let s: ReturnType<typeof startServer>;
  let url: string;
  let scanRoot: string;
  let lastGit: { args: string[]; cwd: string }[] = [];

  const fakeRunGit: RunGit = async (args, cwd) => {
    lastGit.push({ args, cwd });
    if (args[0] === "clone") {
      const dest = args[2]!;
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    }
    return { stdout: "", stderr: "", code: 0 };
  };

  beforeAll(() => {
    scanRoot = mkdtempSync(join(tmpdir(), "forest-create-"));
    setScanRoot(db, scanRoot);
    setProjectSubdirs(db, ["Personal", "Professional"]);
    s = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [
        ...projectRoutes(),
        ...projectCreateRoutes({ runGit: fakeRunGit }),
      ],
    });
    url = `http://${s.hostname}:${s.port}`;
  });

  afterAll(() => s.stop(true));

  test("blank source: mkdir + git init + README + commit", async () => {
    lastGit = [];
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", subdir: "Personal", source: { type: "blank" } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.project.name).toBe("demo");
    expect(body.project.path).toBe(join(scanRoot, "Personal", "demo"));
    expect(body.project.group).toBe("Personal");
    expect(existsSync(join(scanRoot, "Personal", "demo"))).toBe(true);
    expect(existsSync(join(scanRoot, "Personal", "demo", "README.md"))).toBe(true);
    expect(lastGit.map((c) => c.args[0])).toEqual(["init", "add", "commit"]);
  });

  test("clone source: runs git clone with dest", async () => {
    lastGit = [];
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "cloned",
        subdir: "Professional",
        source: { type: "clone", url: "git@github.com:foo/bar.git" },
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.project.path).toBe(join(scanRoot, "Professional", "cloned"));
    expect(lastGit).toHaveLength(1);
    expect(lastGit[0]!.args).toEqual(["clone", "git@github.com:foo/bar.git", join(scanRoot, "Professional", "cloned")]);
  });

  test("empty subdir places project directly under scan root", async () => {
    lastGit = [];
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "toplevel", subdir: "", source: { type: "blank" } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.project.path).toBe(join(scanRoot, "toplevel"));
    expect(body.project.group).toBeNull();
  });

  test("400 on invalid name", async () => {
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "../bad", subdir: "", source: { type: "blank" } }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/invalid project name/);
  });

  test("400 on subdir not in allow-list", async () => {
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", subdir: "Random", source: { type: "blank" } }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/unknown subdir: Random/);
  });

  test("400 if destination already exists on disk", async () => {
    const dest = join(scanRoot, "Personal", "preexisting");
    mkdirSync(dest, { recursive: true });
    const r = await fetch(`${url}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preexisting", subdir: "Personal", source: { type: "blank" } }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/destination already exists/);
  });

  test("400 + cleanup if git step fails", async () => {
    const failingGit: RunGit = async () => ({ stdout: "", stderr: "fatal: simulated", code: 1 });
    const s2 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectCreateRoutes({ runGit: failingGit })],
    });
    try {
      const url2 = `http://${s2.hostname}:${s2.port}`;
      const dest = join(scanRoot, "Personal", "should-rollback");
      const r = await fetch(`${url2}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "should-rollback", subdir: "Personal", source: { type: "blank" } }),
      });
      expect(r.status).toBe(400);
      expect(existsSync(dest)).toBe(false);
    } finally {
      s2.stop(true);
    }
  });

  test("503 if scanRoot is not set", async () => {
    const db2 = openDb(":memory:");
    const s2 = startServer({
      port: 0,
      db: db2,
      loop,
      log,
      routes: [...projectRoutes(), ...projectCreateRoutes({ runGit: fakeRunGit })],
    });
    try {
      const url2 = `http://${s2.hostname}:${s2.port}`;
      const r = await fetch(`${url2}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", subdir: "", source: { type: "blank" } }),
      });
      expect(r.status).toBe(503);
      expect((await r.json()).error).toMatch(/scanRoot/);
    } finally {
      s2.stop(true);
    }
  });
});

// Shared server + state for the tree and file describe blocks below.
// The server is started once in the outer beforeAll and stopped in the outer afterAll
// so it remains alive for both sibling describes.
describe("files routes (tree + file)", () => {
  let treeServer: ReturnType<typeof startServer>;
  let url: string;
  let projRoot: string;
  let pid: string;

  beforeAll(() => {
    projRoot = mkdtempSync(join(tmpdir(), "forest-tree-"));
    mkdirSync(join(projRoot, "src"), { recursive: true });
    mkdirSync(join(projRoot, "src/ui"), { recursive: true });
    wf(join(projRoot, "src/main.ts"), "console.log('hi')");
    wf(join(projRoot, "src/ui/App.tsx"), "export default 1");
    wf(join(projRoot, "package.json"), "{}");
    // PNG magic bytes + a null byte — would be detected as "binary" without image handling.
    wf(join(projRoot, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));
    wf(join(projRoot, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    pid = upsertProject(db, { path: projRoot, name: "treetest" });
    upsertSnapshot(db, pid, emptySnapshot());

    const fakeRunGit: RunGit = async (args) => {
      if (args[0] === "ls-files") {
        return {
          stdout: "package.json\nsrc/main.ts\nsrc/ui/App.tsx\n",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    treeServer = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: fakeRunGit })],
    });
    url = `http://${treeServer.hostname}:${treeServer.port}`;
  });

  afterAll(() => treeServer.stop(true));

  describe("GET /api/projects/:id/tree", () => {
    test("returns flat tree entries with sizes", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/tree`);
      expect(r.status).toBe(200);
      const body = await r.json();
      const paths = body.entries.map((e: any) => e.path).sort();
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/main.ts");
      expect(paths).toContain("src/ui/App.tsx");
      expect(paths).toContain("src");
      expect(paths).toContain("src/ui");
      const main = body.entries.find((e: any) => e.path === "src/main.ts");
      expect(main.type).toBe("file");
      expect(main.size).toBeGreaterThan(0);
      const dir = body.entries.find((e: any) => e.path === "src");
      expect(dir.type).toBe("dir");
      expect(dir.size).toBeNull();
    });

    test("404 on unknown project", async () => {
      const r = await fetch(`${url}/api/projects/missing/tree`);
      expect(r.status).toBe(404);
    });
  });

describe("GET /api/projects/:id/tree (fs fallback)", () => {
  let s2: ReturnType<typeof startServer>;
  let url2: string;
  let projRoot2: string;
  let pid2: string;

  beforeAll(() => {
    projRoot2 = mkdtempSync(join(tmpdir(), "forest-tree-fs-"));
    mkdirSync(join(projRoot2, "lib"), { recursive: true });
    wf(join(projRoot2, "lib/util.ts"), "export const x = 1");
    wf(join(projRoot2, "README.md"), "# hello");
    mkdirSync(join(projRoot2, ".hidden"), { recursive: true });
    wf(join(projRoot2, ".hidden/secret"), "no");
    mkdirSync(join(projRoot2, "node_modules"), { recursive: true });
    wf(join(projRoot2, "node_modules/dep.js"), "skip");

    pid2 = upsertProject(db, { path: projRoot2, name: "fstest" });
    upsertSnapshot(db, pid2, emptySnapshot());

    const failingRunGit: RunGit = async () => ({ stdout: "", stderr: "not a git repo", code: 128 });

    s2 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: failingRunGit })],
    });
    url2 = `http://${s2.hostname}:${s2.port}`;
  });

  afterAll(() => s2.stop(true));

  test("falls back to fs walk and skips .git/.hidden/node_modules", async () => {
    const r = await fetch(`${url2}/api/projects/${pid2}/tree`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).toContain("lib/util.ts");
    expect(paths).toContain("README.md");
    expect(paths).toContain("lib");
    // top-level dotfile dirs and node_modules are skipped
    expect(paths).not.toContain(".hidden");
    expect(paths).not.toContain(".hidden/secret");
    expect(paths).not.toContain("node_modules");
    expect(paths).not.toContain("node_modules/dep.js");
  });
});

  describe("GET /api/projects/:id/file", () => {
    test("returns text payload with content + sha + mtime + language", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=src/main.ts`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.kind).toBe("text");
      expect(body.path).toBe("src/main.ts");
      expect(body.content).toBe("console.log('hi')");
      expect(body.language).toBe("typescript");
      expect(typeof body.mtimeMs).toBe("number");
      const expectedSha = ch("sha256").update("console.log('hi')").digest("hex");
      expect(body.sha).toBe(expectedSha);
    });

    test("returns binary kind for files containing null bytes", async () => {
      writeFileSync(join(projRoot, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      const r = await fetch(`${url}/api/projects/${pid}/file?path=blob.bin`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.kind).toBe("binary");
      expect(body.size).toBe(4);
    });

    test("returns too-large kind for files > 2 MB", async () => {
      const huge = "x".repeat(2 * 1024 * 1024 + 1);
      writeFileSync(join(projRoot, "huge.txt"), huge);
      const r = await fetch(`${url}/api/projects/${pid}/file?path=huge.txt`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.kind).toBe("too-large");
      expect(body.size).toBeGreaterThan(2 * 1024 * 1024);
    });

    test("returns image kind for png files (not binary)", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=logo.png`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.kind).toBe("image");
      expect(body.path).toBe("logo.png");
      expect(body.mime).toBe("image/png");
      expect(body.size).toBeGreaterThan(0);
      expect(typeof body.mtimeMs).toBe("number");
    });

    test("returns image kind for svg files", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=icon.svg`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.kind).toBe("image");
      expect(body.mime).toBe("image/svg+xml");
    });

    test("400 on path traversal", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=../escape`);
      expect(r.status).toBe(400);
    });

    test("404 on missing file", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=nope.txt`);
      expect(r.status).toBe(404);
    });

    test("400 when path points to a directory", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=src`);
      expect(r.status).toBe(400);
    });

    test("404 on unknown project", async () => {
      const r = await fetch(`${url}/api/projects/missing/file?path=x`);
      expect(r.status).toBe(404);
    });
  });

  describe("GET /api/projects/:id/file/raw", () => {
    test("streams raw bytes with the image content-type", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file/raw?path=logo.png`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await r.arrayBuffer());
      expect(bytes[0]).toBe(0x89); // PNG magic
      expect(bytes[1]).toBe(0x50);
    });

    test("serves svg with svg+xml content-type", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file/raw?path=icon.svg`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/svg+xml");
    });

    test("sends hardening headers that block script execution", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file/raw?path=icon.svg`);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("content-security-policy")).toBe("script-src 'none'; sandbox");
    });

    test("rejects path traversal", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file/raw?path=../escape`);
      expect(r.status).toBe(400);
    });

    test("404 on missing file", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file/raw?path=nope.png`);
      expect(r.status).toBe(404);
    });

    test("404 on unknown project", async () => {
      const r = await fetch(`${url}/api/projects/missing/file/raw?path=logo.png`);
      expect(r.status).toBe(404);
    });
  });

  describe("PUT /api/projects/:id/file", () => {
    test("writes content and returns new mtime + sha", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=src/main.ts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "export const x = 1\n" }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.path).toBe("src/main.ts");
      expect(typeof body.mtimeMs).toBe("number");
      expect(body.sha).toMatch(/^[a-f0-9]{64}$/);
      const onDisk = await Bun.file(join(projRoot, "src/main.ts")).text();
      expect(onDisk).toBe("export const x = 1\n");
    });

    test("409 stale when expectedMtimeMs is older than disk", async () => {
      writeFileSync(join(projRoot, "stale.txt"), "v1");
      const r1 = await fetch(`${url}/api/projects/${pid}/file?path=stale.txt`);
      const orig = await r1.json();
      // Simulate disk-side change after we read mtime
      await new Promise((res) => setTimeout(res, 20));
      writeFileSync(join(projRoot, "stale.txt"), "v2");
      const r2 = await fetch(`${url}/api/projects/${pid}/file?path=stale.txt`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "user-edit", expectedMtimeMs: orig.mtimeMs }),
      });
      expect(r2.status).toBe(409);
      const body = await r2.json();
      expect(body.error).toBe("stale");
      expect(typeof body.currentMtimeMs).toBe("number");
      expect(body.currentSha).toMatch(/^[a-f0-9]{64}$/);
    });

    test("overwrite (no expectedMtimeMs) skips the conflict check", async () => {
      writeFileSync(join(projRoot, "force.txt"), "v1");
      await new Promise((res) => setTimeout(res, 20));
      writeFileSync(join(projRoot, "force.txt"), "v2");
      const r = await fetch(`${url}/api/projects/${pid}/file?path=force.txt`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "v3" }),
      });
      expect(r.status).toBe(200);
      const onDisk = await Bun.file(join(projRoot, "force.txt")).text();
      expect(onDisk).toBe("v3");
    });

    test("400 on path traversal", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=../escape`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      });
      expect(r.status).toBe(400);
    });

    test("400 on missing content body", async () => {
      const r = await fetch(`${url}/api/projects/${pid}/file?path=src/main.ts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(400);
    });

    test("404 on unknown project", async () => {
      const r = await fetch(`${url}/api/projects/missing/file?path=src/main.ts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      });
      expect(r.status).toBe(404);
    });
  });
}); // end "files routes (tree + file)"

describe("GET /api/projects/:id/tree (with gitStatus)", () => {
  let s3: ReturnType<typeof startServer>;
  let url3: string;
  let projRoot3: string;
  let pid3: string;

  beforeAll(() => {
    projRoot3 = mkdtempSync(join(tmpdir(), "forest-tree-status-"));
    mkdirSync(join(projRoot3, "src"), { recursive: true });
    wf(join(projRoot3, "src/main.ts"), "console.log('hi')");
    wf(join(projRoot3, "package.json"), "{}");
    wf(join(projRoot3, "untracked.md"), "new file");

    pid3 = upsertProject(db, { path: projRoot3, name: "treestatustest" });
    upsertSnapshot(db, pid3, emptySnapshot());

    const fakeRunGit: RunGit = async (args) => {
      if (args[0] === "ls-files") {
        return {
          stdout: "package.json\nsrc/main.ts\n",
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "status") {
        // src/main.ts modified, untracked.md is untracked
        return {
          stdout: " M src/main.ts\0?? untracked.md\0",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    s3 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: fakeRunGit })],
    });
    url3 = `http://${s3.hostname}:${s3.port}`;
  });

  afterAll(() => s3.stop(true));

  test("file entries carry gitStatus from git status --porcelain", async () => {
    const r = await fetch(`${url3}/api/projects/${pid3}/tree`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const main = body.entries.find((e: any) => e.path === "src/main.ts");
    const untracked = body.entries.find((e: any) => e.path === "untracked.md");
    const pkg = body.entries.find((e: any) => e.path === "package.json");
    expect(main.gitStatus).toBe("M");
    expect(untracked.gitStatus).toBe("?");
    // Clean tracked files have null (or absent — we accept both)
    expect(pkg.gitStatus ?? null).toBeNull();
  });

  test("directory entries always have gitStatus null", async () => {
    const r = await fetch(`${url3}/api/projects/${pid3}/tree`);
    const body = await r.json();
    const dir = body.entries.find((e: any) => e.path === "src");
    expect(dir.gitStatus ?? null).toBeNull();
  });

  test("when status fails, entries still return without gitStatus", async () => {
    const failingStatusGit: RunGit = async (args) => {
      if (args[0] === "ls-files") {
        return { stdout: "package.json\n", stderr: "", code: 0 };
      }
      if (args[0] === "status") {
        return { stdout: "", stderr: "fatal: bad status", code: 128 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const s4 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: failingStatusGit })],
    });
    try {
      const url4 = `http://${s4.hostname}:${s4.port}`;
      const r = await fetch(`${url4}/api/projects/${pid3}/tree`);
      expect(r.status).toBe(200);
      const body = await r.json();
      const pkg = body.entries.find((e: any) => e.path === "package.json");
      expect(pkg.gitStatus ?? null).toBeNull();
    } finally {
      s4.stop(true);
    }
  });
});

describe("GET /api/projects/:id/tree (with ignored files)", () => {
  let s5: ReturnType<typeof startServer>;
  let url5: string;
  let projRoot5: string;
  let pid5: string;

  beforeAll(() => {
    projRoot5 = mkdtempSync(join(tmpdir(), "forest-tree-ignored-"));
    mkdirSync(join(projRoot5, "src"), { recursive: true });
    mkdirSync(join(projRoot5, "dist"), { recursive: true });
    mkdirSync(join(projRoot5, "node_modules", "foo"), { recursive: true });
    wf(join(projRoot5, "src/main.ts"), "console.log('hi')");
    wf(join(projRoot5, "package.json"), "{}");
    wf(join(projRoot5, ".env"), "SECRET=1");
    wf(join(projRoot5, "dist/bundle.js"), "/* built */");
    wf(join(projRoot5, "node_modules/foo/index.js"), "/* dep */");

    pid5 = upsertProject(db, { path: projRoot5, name: "treeignoredtest" });
    upsertSnapshot(db, pid5, emptySnapshot());

    const fakeRunGit: RunGit = async (args) => {
      if (args[0] === "ls-files" && args.includes("--ignored")) {
        // With --directory, git collapses ignored dirs to single entries (trailing /).
        return {
          stdout: ".env\ndist/\nnode_modules/\n",
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "ls-files") {
        return {
          stdout: "package.json\nsrc/main.ts\n",
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "status") {
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    s5 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: fakeRunGit })],
    });
    url5 = `http://${s5.hostname}:${s5.port}`;
  });

  afterAll(() => s5.stop(true));

  test("ignored files appear with gitStatus '!'", async () => {
    const r = await fetch(`${url5}/api/projects/${pid5}/tree`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const env = body.entries.find((e: any) => e.path === ".env");
    expect(env).toBeDefined();
    expect(env.type).toBe("file");
    expect(env.gitStatus).toBe("!");
  });

  test("ignored directories appear as single dimmed entries with no children", async () => {
    const r = await fetch(`${url5}/api/projects/${pid5}/tree`);
    const body = await r.json();
    const distDir = body.entries.find((e: any) => e.path === "dist");
    expect(distDir).toBeDefined();
    expect(distDir.type).toBe("dir");
    expect(distDir.gitStatus).toBe("!");
    // Crucially: no children of dist/ are surfaced.
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).not.toContain("dist/bundle.js");
  });

  test("node_modules collapses to a single dimmed dir entry", async () => {
    const r = await fetch(`${url5}/api/projects/${pid5}/tree`);
    const body = await r.json();
    const nm = body.entries.find((e: any) => e.path === "node_modules");
    expect(nm).toBeDefined();
    expect(nm.type).toBe("dir");
    expect(nm.gitStatus).toBe("!");
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).not.toContain("node_modules/foo");
    expect(paths).not.toContain("node_modules/foo/index.js");
  });

  test("tracked files take precedence over ignored", async () => {
    const r = await fetch(`${url5}/api/projects/${pid5}/tree`);
    const body = await r.json();
    const pkg = body.entries.find((e: any) => e.path === "package.json");
    expect(pkg.gitStatus ?? null).toBeNull();
  });

  test("when ignored ls-files fails, tree still returns tracked files", async () => {
    const failingIgnoredGit: RunGit = async (args) => {
      if (args[0] === "ls-files" && args.includes("--ignored")) {
        return { stdout: "", stderr: "fatal: ignored failed", code: 128 };
      }
      if (args[0] === "ls-files") {
        return { stdout: "package.json\nsrc/main.ts\n", stderr: "", code: 0 };
      }
      if (args[0] === "status") {
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const s6 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: failingIgnoredGit })],
    });
    try {
      const url6 = `http://${s6.hostname}:${s6.port}`;
      const r = await fetch(`${url6}/api/projects/${pid5}/tree`);
      expect(r.status).toBe(200);
      const body = await r.json();
      const paths = body.entries.map((e: any) => e.path);
      expect(paths).toContain("package.json");
      expect(paths).not.toContain(".env");
    } finally {
      s6.stop(true);
    }
  });
});

describe("GET /api/projects/:id/tree?path= (lazy children)", () => {
  let s6: ReturnType<typeof startServer>;
  let url6: string;
  let projRoot6: string;
  let pid6: string;

  beforeAll(() => {
    projRoot6 = mkdtempSync(join(tmpdir(), "forest-tree-lazy-"));
    mkdirSync(join(projRoot6, "vendor/sub"), { recursive: true });
    mkdirSync(join(projRoot6, "vendor/.git"), { recursive: true });
    wf(join(projRoot6, "vendor/a.txt"), "alpha");
    wf(join(projRoot6, "vendor/sub/b.txt"), "beta");
    wf(join(projRoot6, "vendor/.git/HEAD"), "ref");

    pid6 = upsertProject(db, { path: projRoot6, name: "lazytest" });
    upsertSnapshot(db, pid6, emptySnapshot());

    const noopGit: RunGit = async () => ({ stdout: "", stderr: "", code: 0 });
    s6 = startServer({
      port: 0,
      db,
      loop,
      log,
      routes: [...projectRoutes(), ...projectFilesRoutes({ runGit: noopGit })],
    });
    url6 = `http://${s6.hostname}:${s6.port}`;
  });

  afterAll(() => s6.stop(true));

  test("returns immediate children marked '!', skipping .git", async () => {
    const r = await fetch(`${url6}/api/projects/${pid6}/tree?path=vendor`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const byPath = new Map<string, any>(body.entries.map((e: any) => [e.path, e]));
    expect(byPath.get("vendor/a.txt")?.type).toBe("file");
    expect(byPath.get("vendor/a.txt")?.size).toBeGreaterThan(0);
    expect(byPath.get("vendor/a.txt")?.gitStatus).toBe("!");
    expect(byPath.get("vendor/sub")?.type).toBe("dir");
    expect(byPath.get("vendor/sub")?.size).toBeNull();
    expect(byPath.get("vendor/sub")?.gitStatus).toBe("!");
    expect(byPath.has("vendor/.git")).toBe(false);
  });

  test("does not recurse — nested files are absent", async () => {
    const r = await fetch(`${url6}/api/projects/${pid6}/tree?path=vendor`);
    const body = await r.json();
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).not.toContain("vendor/sub/b.txt");
  });

  test("400 when the path escapes the project root", async () => {
    const r = await fetch(
      `${url6}/api/projects/${pid6}/tree?path=${encodeURIComponent("../escape")}`,
    );
    expect(r.status).toBe(400);
  });

  test("404 when the path is a file, not a directory", async () => {
    const r = await fetch(
      `${url6}/api/projects/${pid6}/tree?path=${encodeURIComponent("vendor/a.txt")}`,
    );
    expect(r.status).toBe(404);
  });

  test("404 when the path does not exist", async () => {
    const r = await fetch(`${url6}/api/projects/${pid6}/tree?path=nope`);
    expect(r.status).toBe(404);
  });
});
