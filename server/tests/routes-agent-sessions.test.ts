import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { agentSessionsRoutes } from "../src/routes/agent-sessions";
import { transcriptPathFor } from "../src/sessions/transcript-relocate";
import { upsertProject } from "../src/store/projects";
import { LiveAgentSessions } from "../src/sessions/live";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-routes-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string>) {
  return {
    db, log: () => {}, loop: { start() {}, stop() {} } as never,
    url: new URL(request.url), params, request,
  };
}

describe("agent-sessions routes", () => {
  test("POST /api/agent-sessions/ingest archives a transcript file", async () => {
    const db = openDb(":memory:");
    const projectPath = join(tmp, "proj");
    mkdirSync(projectPath, { recursive: true });
    const projectId = upsertProject(db, { path: projectPath, name: "proj" });

    const sid = "sid-r-1";
    const claudeRoot = join(tmp, "claude-projects");
    const slugDir = join(claudeRoot, "projects", "-tmp-proj");
    const transcript = join(slugDir, `${sid}.jsonl`);
    mkdirSync(slugDir, { recursive: true });
    const line = JSON.stringify({
      type: "user", uuid: "u1", timestamp: "2026-05-09T00:00:00Z",
      message: { role: "user", content: "hi" }, sessionId: sid, cwd: projectPath,
    });
    writeFileSync(transcript, line + "\n");

    const routes = agentSessionsRoutes({
      vault: new Vault(db),
      listProjects: () => [{ id: projectId, path: projectPath }],
      claudeConfigDirs: () => [{ path: claudeRoot, profile: "default" }],
    });
    const ingestRoute = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/agent-sessions/ingest", {
      method: "POST",
      headers: { "x-forest-event": "sessionend" },
      body: JSON.stringify({ session_id: sid, cwd: projectPath, transcript_path: transcript }),
    });
    const res = await ingestRoute.handler(ctx(db, req, {}));
    expect(res.status).toBe(200);
    const count = db.query<{ n: number }, []>("SELECT count(*) AS n FROM agent_messages").get();
    expect(count?.n).toBe(1);
  });

  test("GET /api/projects/:id/agent-sessions returns recent rows", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.query(
      "INSERT INTO projects (id, path, name, pinned, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)",
    ).run("pid", "/p", "proj", now, now);
    const v = new Vault(db);
    v.upsertSession({
      session_id: "s1", agent: "claude", cwd: "/p",
      last_activity: 1, project_id: "pid", source: "scan",
    });
    const routes = agentSessionsRoutes({
      vault: v, listProjects: () => [], claudeConfigDirs: () => [{ path: tmp, profile: "default" }],
    });
    const route = routes.find(
      (r) => r.method === "GET" && r.pattern.test("/api/projects/pid/agent-sessions"),
    )!;
    const req = new Request("http://x/api/projects/pid/agent-sessions");
    const res = await route.handler(ctx(db, req, { id: "pid" }));
    const body = await res.json() as { sessions: Array<{ session_id: string }> };
    expect(body.sessions[0]!.session_id).toBe("s1");
  });

  test("ingest feeds the live registry; GET /api/agent-sessions/live returns it", async () => {
    const db = openDb(":memory:");
    const projectPath = join(tmp, "proj");
    mkdirSync(projectPath, { recursive: true });
    const projectId = upsertProject(db, { path: projectPath, name: "proj" });

    const sid = "live-sid-1";
    const claudeRoot = join(tmp, "claude-projects");
    const slugDir = join(claudeRoot, "projects", "-tmp-proj");
    const transcript = join(slugDir, `${sid}.jsonl`);
    mkdirSync(slugDir, { recursive: true });
    const line = JSON.stringify({
      type: "user", uuid: "u1", timestamp: "2026-05-09T00:00:00Z",
      message: { role: "user", content: "hello forest" }, sessionId: sid, cwd: projectPath,
    });
    writeFileSync(transcript, line + "\n");

    const live = new LiveAgentSessions();
    const routes = agentSessionsRoutes({
      vault: new Vault(db),
      listProjects: () => [{ id: projectId, path: projectPath }],
      claudeConfigDirs: () => [{ path: claudeRoot, profile: "default" }],
      liveSessions: live,
      projectName: (id) => (id === projectId ? "proj" : null),
    });

    const ingest = routes.find((r) => r.method === "POST")!;
    const req = new Request("http://x/api/agent-sessions/ingest", {
      method: "POST",
      headers: { "x-forest-event": "userpromptsubmit", "x-forest-pty": "pty-77" },
      body: JSON.stringify({ session_id: sid, cwd: projectPath, transcript_path: transcript, prompt: "do the thing" }),
    });
    const res = await ingest.handler(ctx(db, req, {}));
    expect(res.status).toBe(200);

    const liveRoute = routes.find((r) => r.method === "GET" && r.pattern.test("/api/agent-sessions/live"))!;
    const lr = await liveRoute.handler(ctx(db, new Request("http://x/api/agent-sessions/live"), {}));
    const body = (await lr.json()) as {
      sessions: Array<{ agentSessionId: string; state: string; ptySessionId: string | null; projectId: string | null; projectName: string | null; lastUserMsg: string | null }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.agentSessionId).toBe(sid);
    expect(body.sessions[0]!.state).toBe("working");
    expect(body.sessions[0]!.ptySessionId).toBe("pty-77");
    expect(body.sessions[0]!.projectId).toBe(projectId);
    expect(body.sessions[0]!.projectName).toBe("proj");
    expect(body.sessions[0]!.lastUserMsg).toBe("do the thing");
  });
});

describe("POST /api/agent-sessions/:sid/prepare-resume", () => {
  const SID = "sid-resume-1";

  /** A session recorded in a worktree that has since been deleted. */
  function setup(opts: { seedTranscript: boolean }) {
    const db = openDb(":memory:");
    const projectPath = join(tmp, "proj");
    const worktreePath = join(projectPath, ".worktrees", "task-foo");
    mkdirSync(projectPath, { recursive: true });
    const projectId = upsertProject(db, { path: projectPath, name: "proj" });

    const claudeRoot = join(tmp, "claude-cfg");
    if (opts.seedTranscript) {
      const src = transcriptPathFor(claudeRoot, worktreePath, SID);
      mkdirSync(join(src, ".."), { recursive: true });
      writeFileSync(src, '{"cwd":"gone"}\n');
    }

    const vault = new Vault(db);
    vault.upsertSession({
      session_id: SID, agent: "claude", cwd: worktreePath,
      last_activity: 1, source: "scan", profile: "default",
    });

    const routes = agentSessionsRoutes({
      vault,
      listProjects: () => [{ id: projectId, path: projectPath }],
      claudeConfigDirs: () => [{ path: claudeRoot, profile: "default" }],
    });
    const route = routes.find((r) =>
      r.method === "POST" && r.pattern.test(`/api/agent-sessions/${SID}/prepare-resume`),
    )!;
    return { db, route, projectPath, claudeRoot };
  }

  const call = (route: { handler: (c: never) => Promise<Response> | Response }, db: ReturnType<typeof openDb>, sid: string, body: unknown) =>
    route.handler(ctx(db, new Request(`http://x/api/agent-sessions/${sid}/prepare-resume`, {
      method: "POST", body: JSON.stringify(body),
    }), { sid }) as never);

  test("copies the transcript into the target cwd's slug dir", async () => {
    const { db, route, projectPath, claudeRoot } = setup({ seedTranscript: true });

    const res = await call(route, db, SID, { cwd: projectPath });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("copied");

    // claude --resume, run from main, will now find it
    expect(existsSync(transcriptPathFor(claudeRoot, projectPath, SID))).toBe(true);
  });

  test("is idempotent — second call reports the transcript already present", async () => {
    const { db, route, projectPath } = setup({ seedTranscript: true });
    await call(route, db, SID, { cwd: projectPath });
    const res = await call(route, db, SID, { cwd: projectPath });
    expect((await res.json()).status).toBe("present");
  });

  test("400s when the transcript cannot be found", async () => {
    const { db, route, projectPath } = setup({ seedTranscript: false });
    const res = await call(route, db, SID, { cwd: projectPath });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/transcript not found/i);
  });

  test("400s when cwd is missing", async () => {
    const { db, route } = setup({ seedTranscript: true });
    const res = await call(route, db, SID, {});
    expect(res.status).toBe(400);
  });

  test("404s for an unknown session", async () => {
    const { db, route, projectPath } = setup({ seedTranscript: true });
    const res = await call(route, db, "no-such-sid", { cwd: projectPath });
    expect(res.status).toBe(404);
  });
});
