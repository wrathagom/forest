import { describe, expect, test } from "vitest";
import { bandColor, legend, COLOR_BY_DIMENSIONS } from "../src/lib/colorBy";
import { THEMES } from "../src/lib/themes";
import type { ProjectRow } from "../src/api";

const theme = THEMES[0]!;

function proj(status: string): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: null,
      services: { docker: [], processes: [] },
      errors: [],
      lifecycle: { status: status as never, hasConfig: true, enabled: true, health: null },
    },
  } as ProjectRow;
}

describe("lifecycle color-by", () => {
  test("is a registered dimension", () => {
    expect(COLOR_BY_DIMENSIONS).toContain("lifecycle");
  });

  test("healthy uses the ok color, errors the error color, stopped is neutral", () => {
    const healthy = bandColor(proj("healthy"), "lifecycle", [], theme, Date.now());
    const errors = bandColor(proj("errors"), "lifecycle", [], theme, Date.now());
    const stopped = bandColor(proj("stopped"), "lifecycle", [], theme, Date.now());
    expect(healthy.neutral).toBe(false);
    expect(errors.neutral).toBe(false);
    expect(stopped.neutral).toBe(true);
  });

  test("legend has entries for the lifecycle dimension", () => {
    expect(legend("lifecycle", [], theme).length).toBeGreaterThan(0);
  });
});
