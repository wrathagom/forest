import { describe, expect, test } from "bun:test";
import { renderHud, renderAlert } from "../src/bbs/render";
import type { LiveEntry } from "../src/sessions/live";

function entry(over: Partial<LiveEntry> = {}): LiveEntry {
  return {
    agentSessionId: "s1", parentSessionId: null, projectId: "p1", projectName: "forest",
    cwd: "/home/u/forest", worktreeLabel: null, branch: "main", profile: null,
    ptySessionId: null, state: "working", endedAt: null, startedAt: 0, lastEventAt: 0,
    lastUserMsg: null, launchedVia: null, ...over,
  };
}

describe("renderHud", () => {
  test("empty state has a 'No active sessions' panel", () => {
    const r = renderHud([], 1000, { panelCap: 6 });
    expect(r.layout).toBe("dashboard-header");
    expect(JSON.stringify(r.content)).toContain("No active sessions");
  });

  test("counts working and waiting in the header", () => {
    const r = renderHud([entry({ agentSessionId: "a", state: "working" }), entry({ agentSessionId: "b", state: "waiting" })], 1000, { panelCap: 6 });
    const header = r.content.find((c) => c.grid_column === "1 / -1");
    expect(header?.value).toContain("1 working");
    expect(header?.value).toContain("1 waiting");
  });

  test("excludes stale sessions", () => {
    const r = renderHud([entry({ state: "stale", projectName: "ghost" })], 1000, { panelCap: 6 });
    expect(JSON.stringify(r.content)).not.toContain("ghost");
    expect(JSON.stringify(r.content)).toContain("No active sessions");
  });

  test("waiting panels are amber, working panels green", () => {
    const r = renderHud([entry({ agentSessionId: "a", state: "waiting", projectName: "wp" })], 1000, { panelCap: 6 });
    const panel = r.content.find((c) => c.value?.includes("wp"));
    expect(panel?.panel_color).toBe("#7a5b16");
  });

  test("caps panels and adds a '+k more'", () => {
    const many = Array.from({ length: 9 }, (_, i) => entry({ agentSessionId: `s${i}`, projectName: `p${i}`, state: "working" }));
    const r = renderHud(many, 1000, { panelCap: 6 });
    expect(JSON.stringify(r.content)).toContain("+3 more");
  });
});

describe("renderAlert", () => {
  test("waiting alert is red", () => {
    const a = renderAlert(entry({ state: "waiting", projectName: "forest", lastUserMsg: "fix the bug" }), "waiting");
    expect(a.content[0].panel_color).toBe("#a01b1b");
    expect(a.content[0].value).toContain("forest needs you");
    expect(a.content[0].value).toContain("fix the bug");
  });

  test("stop alert is blue and says finished", () => {
    const a = renderAlert(entry({ projectName: "forest" }), "stop");
    expect(a.content[0].panel_color).toBe("#16407a");
    expect(a.content[0].value).toContain("forest finished");
  });
});
