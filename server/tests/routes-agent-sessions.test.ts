import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { agentSessionsRoutes } from "../src/routes/agent-sessions";
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
