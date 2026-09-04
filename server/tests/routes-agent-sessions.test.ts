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

  test("GET /api/agent-sessions/live excludes dismissed sessions", async () => {
    const db = openDb(":memory:");
    const projectPath = join(tmp, "proj");
    mkdirSync(projectPath, { recursive: true });
    const projectId = upsertProject(db, { path: projectPath, name: "proj" });

    const sid = "dismiss-sid-1";
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
    await ingest.handler(ctx(db, req, {}));

    const liveRoute = routes.find((r) => r.method === "GET" && r.pattern.test("/api/agent-sessions/live"))!;

    const before = await (await liveRoute.handler(ctx(db, new Request("http://x/api/agent-sessions/live"), {}))).json() as { sessions: Array<{ agentSessionId: string }> };
    expect(before.sessions.map((s) => s.agentSessionId)).toContain(sid);

    live.dismiss(sid);
    const after = await (await liveRoute.handler(ctx(db, new Request("http://x/api/agent-sessions/live"), {}))).json() as { sessions: Array<{ agentSessionId: string }> };
    expect(after.sessions.map((s) => s.agentSessionId)).not.toContain(sid);
  });

  test("GET /api/agent-sessions/live over-fetches so dismissed entries back-fill with legitimately-closed ones", async () => {
    const db = openDb(":memory:");
    const live = new LiveAgentSessions();

    const mkUpdate = (sid: string, event: string, at: number) => ({
      agentSessionId: sid,
      event,
      cwd: "/proj",
      parentSessionId: null,
      projectId: "pid",
      projectName: "proj",
      worktreeLabel: null,
      branch: null,
      profile: null,
      lastUserMsg: null,
      ptySessionId: null,
      at,
    });

    // 8 open sessions -- endedAt stays null, so these always outrank any closed
    // entry regardless of timestamp (list() groups open before closed).
    for (let i = 1; i <= 8; i++) live.applyHookEvent(mkUpdate(`active-${i}`, "stop", 1000 + i));

    // A couple the user marks "done". dismiss() closes them (sets endedAt) without
    // touching lastEventAt, and these two are given the most recent lastEventAt of
    // any closed entry -- so a naive, non-over-fetching read would rank them into
    // the visible top 10 before being filtered out, permanently losing two slots.
    live.applyHookEvent(mkUpdate("dismissed-1", "stop", 500));
    live.applyHookEvent(mkUpdate("dismissed-2", "stop", 490));
    live.dismiss("dismissed-1", 9000);
    live.dismiss("dismissed-2", 9000);

    // 3 legitimately-closed sessions (real SessionEnd, never dismissed), each older
    // by lastEventAt than the dismissed pair. Once the dismissed entries are
    // excluded, "closed-1" -- the most recent of these -- must back-fill the slot
    // a dismissed entry would otherwise have occupied. (applyHookEvent drops a
    // SessionEnd for a session it never saw start, so seed each one first.)
    for (const sid of ["closed-1", "closed-2", "closed-3"]) live.applyHookEvent(mkUpdate(sid, "sessionstart", 1));
    live.applyHookEvent(mkUpdate("closed-1", "sessionend", 480));
    live.applyHookEvent(mkUpdate("closed-2", "sessionend", 470));
    live.applyHookEvent(mkUpdate("closed-3", "sessionend", 460));

    // Sanity check on the setup itself: the raw (unfiltered) top 10 is exactly the
    // 8 active sessions plus the two about to be dismissed -- confirming that,
    // without the over-fetch, "closed-1" would never even be considered.
    expect(live.list(10).map((e) => e.agentSessionId)).toEqual([
      "active-8", "active-7", "active-6", "active-5",
      "active-4", "active-3", "active-2", "active-1",
      "dismissed-1", "dismissed-2",
    ]);

    const routes = agentSessionsRoutes({
      vault: new Vault(db),
      listProjects: () => [],
      claudeConfigDirs: () => [],
      liveSessions: live,
    });
    const liveRoute = routes.find((r) => r.method === "GET" && r.pattern.test("/api/agent-sessions/live"))!;
    const res = await (await liveRoute.handler(ctx(db, new Request("http://x/api/agent-sessions/live"), {}))).json() as {
      sessions: Array<{ agentSessionId: string }>;
    };
    const ids = res.sessions.map((s) => s.agentSessionId);

    expect(ids).not.toContain("dismissed-1");
    expect(ids).not.toContain("dismissed-2");
    expect(ids).toContain("closed-1");
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
