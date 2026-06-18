import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { upsertSnapshot } from "../src/store/snapshots";
import { startServer } from "../src/server";
import { projectRoutes } from "../src/routes/projects";
import { projectGitRoutes } from "../src/routes/git";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";
import { defaultRunGit } from "../src/git";

const db = openDb(":memory:");
const log = () => {};
const loop = createLoop({
  intervalMs: 60_000,
  listVisible: () => [],
  scanProject: async () => emptySnapshot(),
  onSnapshot: () => {},
  log,
});

async function git(args: string[], cwd: string) {
  const r = await defaultRunGit(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

let projRoot: string;
let worktree: string;
let pid: string;
let server: ReturnType<typeof startServer>;
let url: string;

beforeAll(async () => {
  projRoot = mkdtempSync(join(tmpdir(), "forest-gitbr-route-"));
  worktree = mkdtempSync(join(tmpdir(), "forest-gitbr-wt-"));
  await git(["init", "-b", "main"], projRoot);
  await git(["config", "user.email", "test@example.com"], projRoot);
  await git(["config", "user.name", "Test User"], projRoot);
  await git(["config", "commit.gpgsign", "false"], projRoot);

  writeFileSync(join(projRoot, "a.txt"), "one\n");
  await git(["add", "a.txt"], projRoot);
  await git(["commit", "-m", "commit one"], projRoot);

  await git(["branch", "feature"], projRoot);
  await git(["worktree", "add", worktree, "feature"], projRoot);
  writeFileSync(join(worktree, "b.txt"), "feature work\n");
  await git(["add", "b.txt"], worktree);
  await git(["commit", "-m", "feature commit"], worktree);

  pid = upsertProject(db, { path: projRoot, name: "gitbrtest" });
  upsertSnapshot(db, pid, emptySnapshot());

  server = startServer({
    port: 0,
    db,
    loop,
    log,
    routes: [...projectRoutes(), ...projectGitRoutes()],
  });
  url = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(worktree, { recursive: true, force: true });
  rmSync(projRoot, { recursive: true, force: true });
});

describe("GET /api/projects/:id/git/branches", () => {
  test("returns base and the branch list with metadata", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/branches`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.base).toBe("main");
    expect(Array.isArray(body.branches)).toBe(true);
    const names = body.branches.map((b: { name: string }) => b.name).sort();
    expect(names).toEqual(["feature", "main"]);
    const feature = body.branches.find((b: { name: string }) => b.name === "feature");
    expect(feature.ahead).toBe(1);
    expect(feature.hasWorktree).toBe(true);
  });

  test("404s for an unknown project", async () => {
    const r = await fetch(`${url}/api/projects/missing/git/branches`);
    expect(r.status).toBe(404);
  });

  test("404s for a non-git directory", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "forest-gitbr-nongit-"));
    const nonGitId = upsertProject(db, { path: nonGit, name: "nongit-br" });
    upsertSnapshot(db, nonGitId, emptySnapshot());
    try {
      const r = await fetch(`${url}/api/projects/${nonGitId}/git/branches`);
      expect(r.status).toBe(404);
      const body = await r.json();
      expect(body.error).toMatch(/not a git repo/);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe("GET /api/projects/:id/git/log?ref=", () => {
  test("returns commits for the named branch", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/log?ref=feature`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const subjects = body.commits.map((c: { subject: string }) => c.subject);
    expect(subjects).toContain("feature commit");
    expect(subjects).toContain("commit one");
  });

  test("400s for an unresolvable ref", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/log?ref=no-such-branch`);
    expect(r.status).toBe(400);
  });
});
