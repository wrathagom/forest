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
});
