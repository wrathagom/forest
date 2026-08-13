import { describe, expect, test } from "bun:test";
import { LiveAgentSessions } from "../src/sessions/live";

describe("LiveAgentSessions agent field", () => {
  test("hook events default to agent 'claude'", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent({
      agentSessionId: "s1",
      event: "sessionstart",
      cwd: "/tmp/p",
      parentSessionId: null,
      projectId: null,
      projectName: null,
      worktreeLabel: null,
      branch: null,
      profile: null,
      lastUserMsg: null,
      ptySessionId: null,
      at: 1000,
    });
    expect(live.getEntry("s1")?.agent).toBe("claude");
  });

  test("applyCodexScan upserts a codex entry with no profile", () => {
    const live = new LiveAgentSessions();
    live.applyCodexScan({
      agentSessionId: "cx1",
      cwd: "/tmp/studio",
      projectId: "proj",
      projectName: "studio",
      worktreeLabel: "main",
      ptySessionId: "pty-9",
      state: "working",
      endedAt: null,
      startedAt: 1000,
      lastEventAt: 2000,
      lastUserMsg: "hi",
    });
    const e = live.getEntry("cx1");
    expect(e?.agent).toBe("codex");
    expect(e?.profile).toBeNull();
    expect(e?.parentSessionId).toBeNull();
    expect(e?.ptySessionId).toBe("pty-9");
    expect(live.list()).toHaveLength(1);
  });

  test("applyCodexScan does not disturb an existing claude entry", () => {
    const live = new LiveAgentSessions();
    live.applyHookEvent({
      agentSessionId: "s1", event: "sessionstart", cwd: "/tmp/p",
      parentSessionId: null, projectId: null, projectName: null,
      worktreeLabel: null, branch: null, profile: "personal",
      lastUserMsg: null, ptySessionId: null, at: 1000,
    });
    live.applyCodexScan({
      agentSessionId: "cx1", cwd: "/tmp/studio", projectId: null, projectName: null,
      worktreeLabel: null, ptySessionId: null, state: "waiting",
      endedAt: null, startedAt: 1000, lastEventAt: 2000, lastUserMsg: null,
    });
    expect(live.getEntry("s1")?.agent).toBe("claude");
    expect(live.getEntry("s1")?.profile).toBe("personal");
    expect(live.list()).toHaveLength(2);
  });
});
