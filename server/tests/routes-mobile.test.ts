import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/store/db";
import { Vault } from "../src/sessions/vault";
import { LiveAgentSessions } from "../src/sessions/live";
import { AgentRunner } from "../src/sessions/runner";
import { mobileRoutes } from "../src/routes/mobile";
import { upsertProject } from "../src/store/projects";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forest-mobile-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string> = {}) {
  return { db, log: () => {}, loop: { start() {}, stop() {} } as never, url: new URL(request.url), params, request };
}

function build() {
  const db = openDb(":memory:");
  const projPath = join(tmp, "proj");
  mkdirSync(projPath, { recursive: true });
  const projectId = upsertProject(db, { path: projPath, name: "proj" });
  const vault = new Vault(db);
  const liveSessions = new LiveAgentSessions();
  const spawnCalls: string[][] = [];
  const runner = new AgentRunner({
    vault, liveSessions,
    listProjects: () => [{ id: projectId, path: projPath }],
    projectName: () => "proj",
    ptyWriterFor: () => null,
    spawn: ({ cmd }) => { spawnCalls.push(cmd); return { pid: 1, exited: new Promise<number>(() => {}), kill() {} }; },
  });
  const routes = mobileRoutes({ runner, vault, liveSessions, listProjects: () => [{ id: projectId, path: projPath }], projectName: () => "proj" });
  const post = (pathRe: RegExp) => routes.find((r) => r.method === "POST" && pathRe.test(r.pattern.source))!;
  const get = (pathRe: RegExp) => routes.find((r) => r.method === "GET" && pathRe.test(r.pattern.source))!;
  return { db, projPath, projectId, vault, liveSessions, runner, routes, spawnCalls, post, get };
}

const launchReq = (projectId: string, body: object) => new Request("http://x/api/agent-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, ...body }) });

describe("mobile routes", () => {
  test("POST /api/agent-runs launches a run and returns a sessionId", async () => {
    const b = build();
    const res = await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { prompt: "go fix CI", permissionMode: "acceptEdits" })));
    expect(res.status).toBe(200);
    const body = await res.json() as { sessionId: string };
    expect(typeof body.sessionId).toBe("string");
    expect(b.vault.getSession(body.sessionId)!.launched_via).toBe("mobile");
    expect(b.spawnCalls[0]).toContain("--session-id");
  });

  test("POST /api/agent-runs rejects a missing prompt with 400", async () => {
    const b = build();
    expect((await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { permissionMode: "plan" })))).status).toBe(400);
  });

  test("POST /api/agent-runs rejects a bad permissionMode with 400", async () => {
    const b = build();
    expect((await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { prompt: "x", permissionMode: "yolo" })))).status).toBe(400);
  });

  test("POST /api/agent-runs with an unknown project → 404", async () => {
    const b = build();
    expect((await b.post(/agent-runs/).handler(ctx(b.db, launchReq("nope", { prompt: "x", permissionMode: "plan" })))).status).toBe(404);
  });

  test("POST /api/agent-sessions/:sid/reply on an unknown session → 404", async () => {
    const b = build();
    const req = new Request("http://x/api/agent-sessions/ghost/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    expect((await b.post(/reply/).handler(ctx(b.db, req, { sid: "ghost" }))).status).toBe(404);
  });

  test("POST /api/agent-sessions/:sid/reply rejects empty text → 400", async () => {
    const b = build();
    const { sessionId } = await (await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { prompt: "go", permissionMode: "plan" })))).json() as { sessionId: string };
    const req = new Request(`http://x/api/agent-sessions/${sessionId}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "  " }) });
    expect((await b.post(/reply/).handler(ctx(b.db, req, { sid: sessionId }))).status).toBe(400);
  });

  test("POST .../reply on a vault-only session (no live entry) → 204 and spawns claude --resume", async () => {
    const b = build();
    // Seed vault row directly — no live entry, so not in working state
    b.vault.upsertSession({
      session_id: "rs1", agent: "claude", cwd: b.projPath,
      last_activity: 1, project_id: b.projectId, source: "scan",
    });
    const req = new Request("http://x/api/agent-sessions/rs1/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "continue" }) });
    const res = await b.post(/reply/).handler(ctx(b.db, req, { sid: "rs1" }));
    expect(res.status).toBe(204);
    expect(b.spawnCalls.some((c) => c.includes("--resume") && c.includes("continue"))).toBe(true);
  });

  test("GET /api/m/sessions returns the three buckets; a launched run shows under working", async () => {
    const b = build();
    const { sessionId } = await (await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { prompt: "go fix CI", permissionMode: "plan" })))).json() as { sessionId: string };
    const res = await b.get(/api.*m.*sessions/).handler(ctx(b.db, new Request("http://x/api/m/sessions")));
    expect(res.status).toBe(200);
    const body = await res.json() as { needsYou: unknown[]; working: { sessionId: string; label: string; projectName: string | null }[]; recent: unknown[] };
    const w = body.working.find((s) => s.sessionId === sessionId);
    expect(w?.label).toBe("go fix CI");
    expect(w?.projectName).toBe("proj");
  });

  test("needsYou 6-hour window: recent mobile session appears; older-than-6h does not", async () => {
    const b = build();
    const recentSid = "mobile-recent-sid";
    const oldSid = "mobile-old-sid";
    // Recent mobile session (last_activity 1 minute ago) — should appear in needsYou
    b.vault.upsertSession({
      session_id: recentSid,
      agent: "claude",
      cwd: "/tmp/proj",
      last_activity: Date.now() - 60_000,
      source: "mobile",
      launched_via: "mobile",
      project_id: b.projectId,
    });
    // Old mobile session (last_activity 7 hours ago) — should NOT appear in needsYou
    b.vault.upsertSession({
      session_id: oldSid,
      agent: "claude",
      cwd: "/tmp/proj",
      last_activity: Date.now() - 7 * 3600_000,
      source: "mobile",
      launched_via: "mobile",
      project_id: b.projectId,
    });
    const res = await b.get(/api.*m.*sessions/).handler(ctx(b.db, new Request("http://x/api/m/sessions")));
    expect(res.status).toBe(200);
    const body = await res.json() as { needsYou: { sessionId: string }[]; working: unknown[]; recent: { sessionId: string }[] };
    const needsYouIds = body.needsYou.map((s) => s.sessionId);
    expect(needsYouIds).toContain(recentSid);
    expect(needsYouIds).not.toContain(oldSid);
  });

  test("recent sorts mobile-launched sessions before non-mobile ones even when older", async () => {
    const b = build();
    const mobileSid = "mobile-older-sid";
    const nonMobileSid = "non-mobile-newer-sid";
    // Mobile session with last_activity 7 hours ago (outside 6h needsYou window → goes to recent)
    b.vault.upsertSession({
      session_id: mobileSid,
      agent: "claude",
      cwd: "/tmp/proj",
      last_activity: Date.now() - 7 * 3600_000,
      source: "mobile",
      launched_via: "mobile",
      project_id: b.projectId,
    });
    // Non-mobile session with last_activity 1 second ago (newer, but not mobile)
    b.vault.upsertSession({
      session_id: nonMobileSid,
      agent: "claude",
      cwd: "/tmp/proj",
      last_activity: Date.now() - 1000,
      source: "scan",
      launched_via: null,
      project_id: b.projectId,
    });
    const res = await b.get(/api.*m.*sessions/).handler(ctx(b.db, new Request("http://x/api/m/sessions")));
    expect(res.status).toBe(200);
    const body = await res.json() as { needsYou: { sessionId: string }[]; working: unknown[]; recent: { sessionId: string }[] };
    const recentIds = body.recent.map((s) => s.sessionId);
    const mobileIdx = recentIds.indexOf(mobileSid);
    const nonMobileIdx = recentIds.indexOf(nonMobileSid);
    expect(mobileIdx).toBeGreaterThanOrEqual(0);
    expect(nonMobileIdx).toBeGreaterThanOrEqual(0);
    expect(mobileIdx).toBeLessThan(nonMobileIdx);
  });

  test("POST /api/agent-sessions/:sid/done marks the session dismissed → 204", async () => {
    const b = build();
    const { sessionId } = await (await b.post(/agent-runs/).handler(ctx(b.db, launchReq(b.projectId, { prompt: "go", permissionMode: "plan" })))).json() as { sessionId: string };
    const res = await b.post(/done/).handler(ctx(b.db, new Request(`http://x/api/agent-sessions/${sessionId}/done`, { method: "POST" }), { sid: sessionId }));
    expect(res.status).toBe(204);
    expect(b.liveSessions.isDismissed(sessionId)).toBe(true);
  });

  test("a dismissed mobile session drops out of needsYou", async () => {
    const b = build();
    const sid = "mobile-done-sid";
    b.vault.upsertSession({
      session_id: sid, agent: "claude", cwd: "/tmp/proj",
      last_activity: Date.now() - 60_000, source: "mobile", launched_via: "mobile", project_id: b.projectId,
    });
    const list = async () => (await (await b.get(/api.*m.*sessions/).handler(ctx(b.db, new Request("http://x/api/m/sessions")))).json()) as { needsYou: { sessionId: string }[] };
    expect((await list()).needsYou.map((s) => s.sessionId)).toContain(sid);
    await b.post(/done/).handler(ctx(b.db, new Request(`http://x/api/agent-sessions/${sid}/done`, { method: "POST" }), { sid }));
    expect((await list()).needsYou.map((s) => s.sessionId)).not.toContain(sid);
  });
});
