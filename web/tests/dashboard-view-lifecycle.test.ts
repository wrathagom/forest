import { describe, expect, test } from "vitest";
import { statusChips } from "../src/lib/dashboard-view";
import type { ProjectRow } from "../src/api";

function proj(status: string, hasConfig = true, enabled = true, url?: string): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: null,
      services: { docker: [], processes: [] },
      errors: [],
      lifecycle: { status: status as never, hasConfig, enabled, health: null, url },
    },
  } as ProjectRow;
}

describe("lifecycle chip", () => {
  test("healthy shows a running-tone chip", () => {
    const chip = statusChips(proj("healthy"), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip?.tone).toBe("running");
    expect(chip?.label).toBe("healthy");
  });

  test("errors shows an error-tone chip", () => {
    const chip = statusChips(proj("errors"), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip?.tone).toBe("error");
  });

  test("status 'none' shows no lifecycle chip", () => {
    const chip = statusChips(proj("none", false, false), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip).toBeUndefined();
  });
});

describe("url quick-link chip", () => {
  test("running with a url adds a link chip carrying the href", () => {
    const chip = statusChips(proj("running", true, true, "http://localhost:3000"), Date.now())
      .find((c) => c.key === "url");
    expect(chip?.href).toBe("http://localhost:3000");
  });

  test("healthy and starting also show the link chip", () => {
    for (const s of ["healthy", "starting"]) {
      const chip = statusChips(proj(s, true, true, "http://localhost:3000"), Date.now())
        .find((c) => c.key === "url");
      expect(chip?.href).toBe("http://localhost:3000");
    }
  });

  test("stopped hides the link chip even with a url configured", () => {
    const chip = statusChips(proj("stopped", true, true, "http://localhost:3000"), Date.now())
      .find((c) => c.key === "url");
    expect(chip).toBeUndefined();
  });

  test("no chip when there is no url", () => {
    const chip = statusChips(proj("running"), Date.now()).find((c) => c.key === "url");
    expect(chip).toBeUndefined();
  });
});
