import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
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

let projRoot: string;
let pid: string;
let server: ReturnType<typeof startServer>;
let url: string;

async function git(args: string[], cwd: string) {
  const r = await defaultRunGit(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

beforeAll(async () => {
  projRoot = mkdtempSync(join(tmpdir(), "forest-git-route-"));
  await git(["init", "-b", "main"], projRoot);
  await git(["config", "user.email", "test@example.com"], projRoot);
  await git(["config", "user.name", "Test User"], projRoot);
  await git(["config", "commit.gpgsign", "false"], projRoot);

  writeFileSync(join(projRoot, "a.txt"), "first\n");
  await git(["add", "a.txt"], projRoot);
  await git(["commit", "-m", "first commit"], projRoot);

  writeFileSync(join(projRoot, "b.txt"), "second\n");
  await git(["add", "b.txt"], projRoot);
  await git(["commit", "-m", "second commit"], projRoot);

  writeFileSync(join(projRoot, "a.txt"), "first updated\n");
  await git(["add", "a.txt"], projRoot);
  await git(["commit", "-m", "third commit"], projRoot);

  pid = upsertProject(db, { path: projRoot, name: "gittest" });
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
  rmSync(projRoot, { recursive: true, force: true });
});

describe("GET /api/projects/:id/git/log", () => {
  test("returns commits in reverse chronological order with required fields", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/log?limit=10`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.commits)).toBe(true);
    expect(body.commits).toHaveLength(3);
    expect(body.commits[0].subject).toBe("third commit");
    expect(body.commits[1].subject).toBe("second commit");
    expect(body.commits[2].subject).toBe("first commit");
    expect(body.commits[0].sha).toMatch(/^[a-f0-9]{40}$/);
    expect(body.commits[0].author).toBe("Test User <test@example.com>");
    expect(typeof body.commits[0].timestamp).toBe("number");
    expect(body.hasMore).toBe(false);
  });

  test("respects limit and reports hasMore=true when more remain", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/log?limit=2`);
    const body = await r.json();
    expect(body.commits).toHaveLength(2);
    expect(body.hasMore).toBe(true);
  });

  test("paginates with before=<sha>", async () => {
    const first = await (await fetch(`${url}/api/projects/${pid}/git/log?limit=2`)).json();
    const oldest = first.commits[1].sha;
    const r = await fetch(`${url}/api/projects/${pid}/git/log?limit=10&before=${oldest}`);
    const body = await r.json();
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].subject).toBe("first commit");
    expect(body.hasMore).toBe(false);
  });

  test("404s for an unknown project", async () => {
    const r = await fetch(`${url}/api/projects/missing/git/log`);
    expect(r.status).toBe(404);
  });

  test("returns 400 for invalid limit values", async () => {
    for (const bad of ["abc", "0", "-1"]) {
      const r = await fetch(`${url}/api/projects/${pid}/git/log?limit=${bad}`);
      expect(r.status).toBe(400);
    }
  });

  test("returns empty page when paginating before the root commit", async () => {
    const all = await (await fetch(`${url}/api/projects/${pid}/git/log?limit=10`)).json();
    const root = all.commits[all.commits.length - 1].sha;
    const r = await fetch(`${url}/api/projects/${pid}/git/log?before=${root}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.commits).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  test("404s for a non-git directory", async () => {
    const nonGitRoot = mkdtempSync(join(tmpdir(), "forest-nongit-"));
    const nonGitId = upsertProject(db, { path: nonGitRoot, name: "nongit" });
    upsertSnapshot(db, nonGitId, emptySnapshot());
    try {
      const r = await fetch(`${url}/api/projects/${nonGitId}/git/log`);
      expect(r.status).toBe(404);
      const body = await r.json();
      expect(body.error).toMatch(/not a git repo/);
    } finally {
      rmSync(nonGitRoot, { recursive: true, force: true });
    }
  });
});

describe("GET /api/projects/:id/git/diff", () => {
  test("returns empty diff with status null for a clean file", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/diff?path=b.txt`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBeNull();
    expect(body.diff).toBe("");
    expect(body.path).toBe("b.txt");
  });

  test("returns a unified diff and status M for a modified tracked file", async () => {
    writeFileSync(join(projRoot, "a.txt"), "first updated\nplus a new line\n");
    try {
      const r = await fetch(`${url}/api/projects/${pid}/git/diff?path=a.txt`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.status).toBe("M");
      expect(body.diff).toContain("--- a/a.txt");
      expect(body.diff).toContain("+++ b/a.txt");
      expect(body.diff).toContain("+plus a new line");
    } finally {
      writeFileSync(join(projRoot, "a.txt"), "first updated\n");
    }
  });

  test("returns synthesized diff and status ? for an untracked file", async () => {
    writeFileSync(join(projRoot, "untracked.md"), "hello world\n");
    try {
      const r = await fetch(
        `${url}/api/projects/${pid}/git/diff?path=untracked.md`,
      );
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.status).toBe("?");
      expect(body.diff).toContain("+hello world");
    } finally {
      unlinkSync(join(projRoot, "untracked.md"));
    }
  });

  test("returns deletion diff and status D for a deleted tracked file", async () => {
    unlinkSync(join(projRoot, "a.txt"));
    try {
      const r = await fetch(`${url}/api/projects/${pid}/git/diff?path=a.txt`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.status).toBe("D");
      expect(body.diff).toContain("--- a/a.txt");
    } finally {
      writeFileSync(join(projRoot, "a.txt"), "first updated\n");
    }
  });

  test("400 on missing path query", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/diff`);
    expect(r.status).toBe(400);
  });

  test("400 on path traversal", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/diff?path=../escape`);
    expect(r.status).toBe(400);
  });

  test("404 on non-git project", async () => {
    const nonGitRoot = mkdtempSync(join(tmpdir(), "forest-nongit-diff-"));
    const nonGitId = upsertProject(db, { path: nonGitRoot, name: "nongit-diff" });
    upsertSnapshot(db, nonGitId, emptySnapshot());
    try {
      const r = await fetch(
        `${url}/api/projects/${nonGitId}/git/diff?path=foo`,
      );
      expect(r.status).toBe(404);
    } finally {
      rmSync(nonGitRoot, { recursive: true, force: true });
    }
  });
});

describe("GET /api/projects/:id/git/commit", () => {
  test("returns metadata, parents, full message, and combined diff", async () => {
    const head = await git(["rev-parse", "HEAD"], projRoot);
    const r = await fetch(`${url}/api/projects/${pid}/git/commit?sha=${head}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sha).toBe(head);
    expect(Array.isArray(body.parents)).toBe(true);
    expect(body.parents).toHaveLength(1);
    expect(body.parents[0]).toMatch(/^[a-f0-9]{40}$/);
    expect(body.author).toBe("Test User <test@example.com>");
    expect(typeof body.timestamp).toBe("number");
    expect(body.message).toContain("third commit");
    // The third commit modifies a.txt, so diff body should reference it
    expect(body.diff).toContain("a.txt");
    expect(body.diff).toContain("first updated");
  });

  test("first commit has no parents", async () => {
    const first = await git(["rev-list", "--max-parents=0", "HEAD"], projRoot);
    const r = await fetch(`${url}/api/projects/${pid}/git/commit?sha=${first}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.parents).toEqual([]);
    expect(body.diff).toContain("a.txt");
  });

  test("400 on missing sha", async () => {
    const r = await fetch(`${url}/api/projects/${pid}/git/commit`);
    expect(r.status).toBe(400);
  });

  test("404 on unknown sha", async () => {
    const r = await fetch(
      `${url}/api/projects/${pid}/git/commit?sha=0000000000000000000000000000000000000000`,
    );
    expect(r.status).toBe(404);
  });
});
