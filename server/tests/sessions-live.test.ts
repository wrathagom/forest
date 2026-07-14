import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LiveAgentSessions, type LiveUpdate } from "../src/sessions/live";
import { openDb } from "../src/store/db";
import { makeDismissalStore } from "../src/store/dismissals";

const base: Omit<LiveUpdate, "event" | "at"> = {
  agentSessionId: "s1",
  cwd: "/proj",
  parentSessionId: null,
  projectId: "p1",
  projectName: "Proj",
  worktreeLabel: "main",
  branch: null,
  profile: null,
  lastUserMsg: null,
  ptySessionId: null,
};
const ev = (over: Partial<LiveUpdate>): LiveUpdate => ({
  ...base,
  event: "userpromptsubmit",
  at: Date.now(),
  ...over,
});

describe("LiveAgentSessions", () => {
  test("sessionstart → waiting, userpromptsubmit → working, stop → waiting", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "sessionstart" }));
    expect(live.list()[0]!.state).toBe("waiting");
    live.applyHookEvent(ev({ event: "userpromptsubmit", lastUserMsg: "go" }));
    expect(live.list()[0]!.state).toBe("working");
    expect(live.list()[0]!.lastUserMsg).toBe("go");
    live.applyHookEvent(ev({ event: "stop" }));
    expect(live.list()[0]!.state).toBe("waiting");
  });

  test("notification → waiting", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "notification" }));
    expect(live.list()[0]!.state).toBe("waiting");
  });

  test("pretooluse → working, clearing a stale waiting from a notification", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit" }));
    live.applyHookEvent(ev({ event: "notification" }));
    expect(live.list()[0]!.state).toBe("waiting");
    live.applyHookEvent(ev({ event: "pretooluse" }));
    expect(live.list()[0]!.state).toBe("working");
  });

  test("posttooluse → working, clearing a stale waiting from a notification", () => {
    // a completed tool call (notably an answered AskUserQuestion) means the agent
    // is churning again — clears a `waiting` left over from the Notification that
    // posed the question.
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", at: 1000 }));
    live.applyHookEvent(ev({ event: "notification", at: 2000 }));
    expect(live.list()[0]!.state).toBe("waiting");
    live.applyHookEvent(ev({ event: "posttooluse", at: 3000 }));
    expect(live.list()[0]!.state).toBe("working");
    expect(live.list()[0]!.lastEventAt).toBe(3000);
  });

  test("precompact does not change state but bumps activity", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", at: 1000 }));
    live.applyHookEvent(ev({ event: "precompact", at: 2000 }));
    expect(live.list()[0]!.state).toBe("working");
    expect(live.list()[0]!.lastEventAt).toBe(2000);
  });

  test("sessionend → stale with endedAt; userpromptsubmit revives it", () => {
    const live = new LiveAgentSessions();
    const t0 = 1_000_000;
    live.applyHookEvent(ev({ event: "userpromptsubmit", at: t0 }));
    live.applyHookEvent(ev({ event: "sessionend", at: t0 + 10 }));
    expect(live.list()[0]!.state).toBe("stale");
    expect(live.list()[0]!.endedAt).toBe(t0 + 10);
    live.applyHookEvent(ev({ event: "userpromptsubmit", at: t0 + 20 }));
    expect(live.list()[0]!.state).toBe("working");
    expect(live.list()[0]!.endedAt).toBeNull();
  });

  test("a lone sessionend for an unknown session does not create a phantom entry", () => {
    // A failed `claude --resume <bad-id>` still fires SessionEnd on its way out.
    // That orphan event must not seed a new (closed) live entry — otherwise the
    // session bar fills with phantom chips that, when clicked, resume-and-fail
    // again, breeding more phantoms.
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "sessionend", agentSessionId: "orphan" }));
    expect(live.getEntry("orphan")).toBeUndefined();
    expect(live.list()).toHaveLength(0);
  });

  test("sessionend still ends a session that already has a live entry", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "sessionstart", agentSessionId: "real", at: 1000 }));
    live.applyHookEvent(ev({ event: "sessionend", agentSessionId: "real", at: 2000 }));
    expect(live.getEntry("real")!.state).toBe("stale");
    expect(live.getEntry("real")!.endedAt).toBe(2000);
  });

  test("does not clobber known fields with nulls from a later bare event", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", lastUserMsg: "build it", ptySessionId: "pty-1", branch: "feat" }));
    live.applyHookEvent(ev({ event: "stop", lastUserMsg: null, ptySessionId: null, branch: null }));
    const e = live.list()[0]!;
    expect(e.lastUserMsg).toBe("build it");
    expect(e.ptySessionId).toBe("pty-1");
    expect(e.branch).toBe("feat");
  });

  test("markEndedByPty marks the matching entry stale", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", ptySessionId: "pty-9" }));
    live.markEndedByPty("pty-9", 5_000);
    expect(live.list()[0]!.state).toBe("stale");
    expect(live.list()[0]!.endedAt).toBe(5_000);
  });

  test("sessionstart on a resumed session clears a stale endedAt", () => {
    // Resume flow: an earlier PTY hosted this agent session, then exited.
    // markEndedByPty stamped endedAt. The user resumes in a new PTY → SessionStart
    // fires. The new event proves the session is alive again, so endedAt must
    // be cleared — otherwise prune() will silently delete the entry 30 min after
    // the OLD endedAt, even though Claude is actively running.
    const live = new LiveAgentSessions({ endedRetentionMs: 1000 });
    const t0 = 10_000;
    live.applyHookEvent(ev({ event: "userpromptsubmit", ptySessionId: "pty-old", at: t0 }));
    live.markEndedByPty("pty-old", t0 + 10);
    expect(live.getEntry("s1")!.endedAt).toBe(t0 + 10);

    live.applyHookEvent(ev({ event: "sessionstart", ptySessionId: "pty-new", at: t0 + 20 }));
    expect(live.getEntry("s1")!.endedAt).toBeNull();
    expect(live.getEntry("s1")!.ptySessionId).toBe("pty-new");

    // And prune (well past endedRetentionMs from the OLD endedAt) must not drop it.
    live.prune(t0 + 5_000);
    expect(live.getEntry("s1")).toBeDefined();
  });

  test("prune drops long-ended entries and demotes long-idle ones", () => {
    const live = new LiveAgentSessions({ endedRetentionMs: 1000, idleAfterMs: 500 });
    const t0 = 10_000;
    live.applyHookEvent(ev({ agentSessionId: "ended", event: "sessionstart", at: t0 - 10 }));
    live.applyHookEvent(ev({ agentSessionId: "ended", event: "sessionend", at: t0 }));
    live.applyHookEvent(ev({ agentSessionId: "idle", event: "userpromptsubmit", at: t0 }));
    live.prune(t0 + 600);
    const byId = new Map(live.list().map((e) => [e.agentSessionId, e]));
    expect(byId.get("idle")!.state).toBe("stale");
    expect(byId.get("ended")).toBeDefined();
    live.prune(t0 + 2000);
    expect(live.list().some((e) => e.agentSessionId === "ended")).toBe(false);
  });

  test("list excludes sub-agent sessions, sorts by lastEventAt desc, caps at limit", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ agentSessionId: "child", parentSessionId: "p", event: "userpromptsubmit", at: 100 }));
    live.applyHookEvent(ev({ agentSessionId: "old", event: "userpromptsubmit", at: 50 }));
    live.applyHookEvent(ev({ agentSessionId: "new", event: "userpromptsubmit", at: 200 }));
    expect(live.list().map((e) => e.agentSessionId)).toEqual(["new", "old"]);

    const live2 = new LiveAgentSessions();
    for (let i = 0; i < 15; i++) live2.applyHookEvent(ev({ agentSessionId: `s${i}`, event: "stop", at: i }));
    expect(live2.list(10)).toHaveLength(10);
  });

  test("list sinks closed sessions to the end, most-recently-closed first", () => {
    const live = new LiveAgentSessions();
    // Two open sessions and two closed ones, interleaved in time.
    live.applyHookEvent(ev({ agentSessionId: "open-old", event: "userpromptsubmit", at: 100 }));
    live.applyHookEvent(ev({ agentSessionId: "closed-early", event: "sessionstart", at: 150 }));
    live.applyHookEvent(ev({ agentSessionId: "closed-early", event: "sessionend", at: 200 }));
    live.applyHookEvent(ev({ agentSessionId: "open-new", event: "userpromptsubmit", at: 300 }));
    live.applyHookEvent(ev({ agentSessionId: "closed-late", event: "sessionstart", at: 350 }));
    live.applyHookEvent(ev({ agentSessionId: "closed-late", event: "sessionend", at: 400 }));

    // Open sessions first (recency desc), then closed (recency desc) at the far right.
    expect(live.list().map((e) => e.agentSessionId)).toEqual([
      "open-new",
      "open-old",
      "closed-late",
      "closed-early",
    ]);
  });

  test("list drops closed sessions before open ones once the limit is hit", () => {
    const live = new LiveAgentSessions();
    // One closed session that ended most recently, then two newer open sessions.
    live.applyHookEvent(ev({ agentSessionId: "closed", event: "sessionstart", at: 100 }));
    live.applyHookEvent(ev({ agentSessionId: "closed", event: "sessionend", at: 500 }));
    live.applyHookEvent(ev({ agentSessionId: "open-a", event: "userpromptsubmit", at: 200 }));
    live.applyHookEvent(ev({ agentSessionId: "open-b", event: "userpromptsubmit", at: 300 }));

    // With room for 2, the closed session is dropped even though it ended latest.
    expect(live.list(2).map((e) => e.agentSessionId)).toEqual(["open-b", "open-a"]);
  });

  test("noteHeadlessRunStarted seeds a working entry with launchedVia=mobile", () => {
    const live = new LiveAgentSessions();
    live.noteHeadlessRunStarted({
      agentSessionId: "h1", projectId: "p1", projectName: "Proj",
      cwd: "/proj", worktreeLabel: "main", branch: "main", prompt: "go fix CI",
    });
    const e = live.getEntry("h1")!;
    expect(e.state).toBe("working");
    expect(e.launchedVia).toBe("mobile");
    expect(e.ptySessionId).toBeNull();
    expect(e.lastUserMsg).toBe("go fix CI");
    expect(live.list()[0]!.agentSessionId).toBe("h1");
  });

  test("applyHookEvent carries launchedVia through from the update", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", agentSessionId: "h2", launchedVia: "mobile" }));
    expect(live.getEntry("h2")!.launchedVia).toBe("mobile");
  });

  test("applyHookEvent without launchedVia leaves it null, and preserves a prior launchedVia", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "userpromptsubmit", agentSessionId: "h3" }));
    expect(live.getEntry("h3")!.launchedVia).toBeNull();
    live.noteHeadlessRunStarted({ agentSessionId: "h4", projectId: "p", projectName: "P", cwd: "/p", worktreeLabel: "main", branch: null, prompt: "x" });
    live.applyHookEvent(ev({ event: "stop", agentSessionId: "h4" })); // no launchedVia in this update
    expect(live.getEntry("h4")!.launchedVia).toBe("mobile"); // preserved from prev
  });

  test("dismiss marks a session done: isDismissed true, and a live entry goes stale", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent(ev({ event: "stop", agentSessionId: "d1" }));
    expect(live.isDismissed("d1")).toBe(false);
    live.dismiss("d1");
    expect(live.isDismissed("d1")).toBe(true);
    expect(live.getEntry("d1")!.state).toBe("stale");
    expect(live.getEntry("d1")!.endedAt).not.toBeNull();
  });

  test("dismiss works for a session with no live entry (vault-only)", () => {
    const live = new LiveAgentSessions();
    live.dismiss("vault-only");
    expect(live.isDismissed("vault-only")).toBe(true);
    expect(live.getEntry("vault-only")).toBeUndefined();
  });

  test("prune forgets dismissals older than the retention window", () => {
    const live = new LiveAgentSessions({ dismissedRetentionMs: 1000 });
    const t0 = 10_000;
    live.dismiss("old", t0);
    live.dismiss("fresh", t0 + 900);
    live.prune(t0 + 1500);
    expect(live.isDismissed("old")).toBe(false);
    expect(live.isDismissed("fresh")).toBe(true);
  });

  test("dismissals persist via the store and reload into a fresh instance", () => {
    const db: Database = openDb(":memory:");
    const dismissals = makeDismissalStore(db);
    const live1 = new LiveAgentSessions({ dismissals });
    live1.dismiss("p1");
    live1.dismiss("p2");

    // a brand-new instance (simulating a server restart) sees the same dismissals
    const live2 = new LiveAgentSessions({ dismissals: makeDismissalStore(db) });
    expect(live2.isDismissed("p1")).toBe(true);
    expect(live2.isDismissed("p2")).toBe(true);

    // re-engaging a session clears it everywhere, including the store
    live2.applyHookEvent(ev({ event: "userpromptsubmit", agentSessionId: "p1" }));
    expect(live2.isDismissed("p1")).toBe(false);
    expect(new LiveAgentSessions({ dismissals: makeDismissalStore(db) }).isDismissed("p1")).toBe(false);

    // and prune removes the stale one from the store too
    const live3 = new LiveAgentSessions({ dismissals: makeDismissalStore(db), dismissedRetentionMs: 1 });
    live3.prune(Date.now() + 1000);
    expect(makeDismissalStore(db).load()).toEqual([]);
  });

  test("carries profile through to the live entry", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent({
      agentSessionId: "s1", event: "userpromptsubmit", cwd: "/x",
      parentSessionId: null, projectId: null, projectName: null,
      worktreeLabel: null, branch: null, profile: "work", lastUserMsg: "hi",
      ptySessionId: null, at: 1000,
    });
    expect(live.list()[0]?.profile).toBe("work");
  });
});

describe("onChange callback", () => {
  test("fires with event + agentSessionId on a hook event", () => {
    const seen: Array<{ event?: string; agentSessionId?: string }> = [];
    const live = new LiveAgentSessions({ onChange: (c) => seen.push(c) });
    live.applyHookEvent({
      agentSessionId: "s1", event: "notification", cwd: "/x", parentSessionId: null,
      projectId: null, projectName: null, worktreeLabel: null, branch: null, profile: null,
      lastUserMsg: null, ptySessionId: null, at: 1000,
    });
    expect(seen).toContainEqual({ event: "notification", agentSessionId: "s1" });
  });

  test("fires on dismiss", () => {
    const seen: Array<{ event?: string; agentSessionId?: string }> = [];
    const live = new LiveAgentSessions({ onChange: (c) => seen.push(c) });
    live.dismiss("s9", 2000);
    expect(seen).toContainEqual({ event: "dismiss", agentSessionId: "s9" });
  });

  test("fires on markEndedByPty for the matched pty session", () => {
    const seen: Array<{ event?: string; agentSessionId?: string }> = [];
    const live = new LiveAgentSessions({ onChange: (c) => seen.push(c) });
    live.applyHookEvent({
      agentSessionId: "p1", event: "sessionstart", cwd: "/x", parentSessionId: null,
      projectId: null, projectName: null, worktreeLabel: null, branch: null, profile: null,
      lastUserMsg: null, ptySessionId: "pty1", at: 1000,
    });
    live.markEndedByPty("pty1", 3000);
    expect(seen).toContainEqual({ event: "sessionend", agentSessionId: "p1" });
  });
});
