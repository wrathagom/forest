import { describe, expect, test } from "bun:test";
import { BbsPublisher } from "../src/bbs/publisher";
import type { BbsConfig } from "../src/store/config";
import type { LiveEntry } from "../src/sessions/live";

function cfg(over: Partial<BbsConfig> = {}): BbsConfig {
  return {
    enabled: true, accountKey: "ak", baseUrl: "https://bbs.test", screenId: "s1", screenKey: "sk1",
    alertLingerSec: 60, hudIntervalMs: 30000, rotationIntervalSec: 8, hudPanelCap: 6,
    alertEvents: ["waiting", "stop"], ...over,
  };
}
function entry(over: Partial<LiveEntry> = {}): LiveEntry {
  return {
    agentSessionId: "s1", parentSessionId: null, projectId: null, projectName: "forest",
    cwd: "/x", worktreeLabel: null, branch: null, profile: null, ptySessionId: null,
    state: "working", endedAt: null, startedAt: 0, lastEventAt: 0, lastUserMsg: null, launchedVia: null, ...over,
  };
}
type Put = { page: string; body: Record<string, unknown> };
function fakeClient(opts: { fail?: boolean } = {}) {
  const puts: Put[] = [];
  const deletes: string[] = [];
  return {
    puts, deletes,
    client: {
      async putPage(_k: string, _s: string, page: string, body: Record<string, unknown>) {
        if (opts.fail) throw new Error("boom");
        puts.push({ page, body });
      },
      async deletePage(_k: string, _s: string, page: string) { deletes.push(page); },
    } as never,
  };
}
function make(config: BbsConfig, entries: LiveEntry[], fc = fakeClient()) {
  let clock = 0;
  const pub = new BbsPublisher({ client: fc.client, getConfig: () => config, list: () => entries, now: () => clock });
  return { pub, fc, setClock: (n: number) => { clock = n; } };
}

describe("BbsPublisher", () => {
  test("disabled or unprovisioned config is a no-op", async () => {
    const { pub, fc } = make(cfg({ enabled: false }), [entry()]);
    await pub.publishNow();
    expect(fc.puts.length).toBe(0);
    const { pub: p2, fc: fc2 } = make(cfg({ screenId: null }), [entry()]);
    await p2.publishNow();
    expect(fc2.puts.length).toBe(0);
  });

  test("publishes the HUD default page", async () => {
    const { pub, fc } = make(cfg(), [entry({ state: "working" })]);
    await pub.publishNow();
    expect(fc.puts.find((p) => p.page === "default")).toBeTruthy();
  });

  test("a notification transition pushes an alert page for that session", async () => {
    const { pub, fc } = make(cfg(), [entry({ agentSessionId: "a", state: "waiting" })]);
    pub.notifyChange({ event: "notification", agentSessionId: "a" });
    await pub.publishNow();
    const alert = fc.puts.find((p) => p.page === "alert-a");
    expect(alert).toBeTruthy();
    expect(alert?.body.expires_at).toBeUndefined();
    expect(alert?.body.content).toBeTruthy();
  });

  test("does not alert when the session already resolved before publish (flash guard)", async () => {
    const { pub, fc } = make(cfg(), [entry({ agentSessionId: "a", state: "working" })]); // back to working
    pub.notifyChange({ event: "notification", agentSessionId: "a" });
    await pub.publishNow();
    expect(fc.puts.find((p) => p.page === "alert-a")).toBeUndefined();
  });

  test("a resume event clears the session's alert page", async () => {
    const { pub, fc } = make(cfg(), [entry({ agentSessionId: "a", state: "working" })]);
    pub.notifyChange({ event: "userpromptsubmit", agentSessionId: "a" });
    await pub.publishNow();
    expect(fc.deletes).toContain("alert-a");
  });

  test("stop alert fires for stop event", async () => {
    const { pub, fc } = make(cfg(), [entry({ agentSessionId: "a", state: "waiting" })]);
    pub.notifyChange({ event: "stop", agentSessionId: "a" });
    await pub.publishNow();
    expect(fc.puts.find((p) => p.page === "alert-a")).toBeTruthy();
  });

  test("a client error does not throw and is recorded in status", async () => {
    const { pub, fc } = make(cfg(), [entry()], fakeClient({ fail: true }));
    await pub.publishNow();
    expect(pub.status().lastError).toContain("boom");
    void fc;
  });

  test("a fresh notification cancels a queued clear for the same session", async () => {
    const { pub, fc } = make(cfg(), [entry({ agentSessionId: "a", state: "waiting" })]);
    pub.notifyChange({ event: "userpromptsubmit", agentSessionId: "a" }); // queues a clear
    pub.notifyChange({ event: "notification", agentSessionId: "a" });     // should cancel the clear and queue an alert
    await pub.publishNow();
    expect(fc.puts.find((p) => p.page === "alert-a")).toBeTruthy();
    expect(fc.deletes).not.toContain("alert-a");
  });

  test("an alert page is deleted on a later publish once its linger elapses", async () => {
    const { pub, fc, setClock } = make(cfg({ alertLingerSec: 60 }), [entry({ agentSessionId: "a", state: "waiting" })]);
    pub.notifyChange({ event: "notification", agentSessionId: "a" });
    await pub.publishNow(); // pushes alert-a at t=0, expiry t=60000
    expect(fc.puts.find((p) => p.page === "alert-a")).toBeTruthy();
    expect(fc.deletes).not.toContain("alert-a");
    setClock(61_000);
    await pub.publishNow(); // sweep should delete alert-a
    expect(fc.deletes).toContain("alert-a");
  });

  test("an alert is NOT swept before its linger elapses", async () => {
    const { pub, fc, setClock } = make(cfg({ alertLingerSec: 60 }), [entry({ agentSessionId: "a", state: "waiting" })]);
    pub.notifyChange({ event: "notification", agentSessionId: "a" });
    await pub.publishNow();
    setClock(30_000);
    await pub.publishNow();
    expect(fc.deletes).not.toContain("alert-a");
  });
});
