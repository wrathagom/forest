import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/sessions/registry";
import { attach, handleClientFrame, detach } from "../src/sessions/attach";
import { makeFakePtyFactory } from "./helpers/fakePty";

type FakeWs = {
  send: (s: string) => void;
  close: (code?: number) => void;
  sent: string[];
  closeCodes: number[];
  data: { projectId: string; sessionId: string };
};

function mkWs(projectId: string, sessionId: string): FakeWs {
  const sent: string[] = [];
  const closeCodes: number[] = [];
  return {
    send: (s) => sent.push(s),
    close: (c = 1000) => closeCodes.push(c),
    sent,
    closeCodes,
    data: { projectId, sessionId },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkRegistry() {
  const { factory, instances } = makeFakePtyFactory();
  const reg = new SessionRegistry({
    pty: factory,
    maxTotal: 32,
    maxScrollbackBytes: 200_000,
    defaultShell: "/bin/bash",
    coalesceMs: 1,
    exitRetentionMs: 50,
  });
  return { reg, instances };
}

describe("attach", () => {
  test("sends scrollback then registers as an attachment", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    instances[0]!.emitData("seed");
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    expect(ws.sent[0]).toBe(JSON.stringify({ type: "scrollback", data: "seed" }));
    expect(s.attachments.has(ws as never)).toBe(true);
  });

  test("attach to unknown session sends error and closes 4404", () => {
    const { reg } = mkRegistry();
    const ws = mkWs("p1", "missing");
    attach(ws as never, reg);
    expect(ws.sent[0]).toBe(JSON.stringify({ type: "error", message: "unknown session" }));
    expect(ws.closeCodes).toEqual([4404]);
  });

  test("input frame writes to the pty", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    handleClientFrame(ws as never, JSON.stringify({ type: "input", data: "ls\n" }), reg);
    expect(instances[0]!.writes).toEqual(["ls\n"]);
  });

  test("resize frame resizes the pty", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    handleClientFrame(ws as never, JSON.stringify({ type: "resize", cols: 120, rows: 40 }), reg);
    expect(instances[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  test("ping frame replies with pong", () => {
    const { reg } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    ws.sent.length = 0;
    handleClientFrame(ws as never, JSON.stringify({ type: "ping" }), reg);
    expect(ws.sent).toContain(JSON.stringify({ type: "pong" }));
  });

  test("garbage frame is ignored without closing", () => {
    const { reg } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    handleClientFrame(ws as never, "{not json", reg);
    handleClientFrame(ws as never, JSON.stringify({ type: "bogus" }), reg);
    expect(ws.closeCodes).toEqual([]);
  });

  test("detach removes the attachment but keeps the pty alive", () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    detach(ws as never, reg);
    expect(s.attachments.has(ws as never)).toBe(false);
    expect(instances[0]!.killed).toEqual([]);
  });

  test("live pty output is broadcast to attached sockets", async () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    ws.sent.length = 0;
    instances[0]!.emitData("after-attach");
    await wait(20);
    expect(ws.sent).toContain(JSON.stringify({ type: "output", data: "after-attach" }));
  });

  test("attach during pending coalesce window does not double-deliver", async () => {
    const { reg, instances } = mkRegistry();
    const s = reg.create({ projectId: "p1", cwd: "/a", cols: 80, rows: 24 });
    // Use a longer coalesce window for this test by reaching into the registry's
    // internals — easier here: simulate the race manually.
    // Step 1: pty emits data. scrollback gets it; fanout.pending is queued.
    instances[0]!.emitData("burst-1");
    // Step 2: client attaches BEFORE the timer fires.
    const ws = mkWs("p1", s.id);
    attach(ws as never, reg);
    // The scrollback frame should already include "burst-1".
    expect(ws.sent[0]).toContain("burst-1");
    // Step 3: wait long enough for any pending coalesce timer to fire.
    await wait(20);
    // Assert: no second {type:"output", data:"burst-1"} frame ever arrived.
    const outputFrames = ws.sent.filter((s) => s.includes(`"type":"output"`));
    expect(outputFrames).toHaveLength(0);
  });
});
