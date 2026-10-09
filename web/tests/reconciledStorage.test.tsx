import { render, screen } from "@solidjs/testing-library";
import { For, createResource } from "solid-js";
import { MemoryRouter as Router, Route } from "@solidjs/router";
import { describe, expect, test } from "vitest";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";
import { reconciledStorage } from "../src/lib/reconciledStorage";

const row = (): ProjectRow => ({
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false, group: null,
  scannedAt: 1, liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: 1, services: { docker: [], processes: [] }, errors: [],
    lifecycle: { status: "running", hasConfig: true, enabled: true, health: null, url: "http://localhost:3000" },
  },
});

/**
 * Mounts cards the way the dashboard does — a <For> over a polled resource —
 * so a refetch hands back brand-new objects exactly like a real poll.
 */
function renderPolled(next: () => ProjectRow) {
  let refetch!: () => void;
  render(() => {
    const [res, ctl] = createResource(async () => ({ projects: [next()] }), { storage: reconciledStorage });
    refetch = ctl.refetch;
    return (
      <Router>
        <Route path="/" component={() => (
          <For each={res()?.projects ?? []}>
            {(p) => <ProjectCard project={p} preset="status" colorBy="git" groups={[]} onChange={() => {}} />}
          </For>
        )} />
      </Router>
    );
  });
  return () => refetch();
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("reconciledStorage", () => {
  // The regression: every 5s poll rebuilt each card's DOM, so a click whose
  // mousedown and mouseup straddled it never fired — the url chip underlined
  // on hover and did nothing on click.
  test("an unchanged poll keeps the url link element in place", async () => {
    const poll = renderPolled(row);
    const before = await screen.findByRole("link", { name: /open/i });
    poll();
    await settle();
    expect(before.isConnected).toBe(true);
    expect(screen.getByRole("link", { name: /open/i })).toBe(before);
  });

  test("a changed poll updates the link in place rather than rebuilding it", async () => {
    let url = "http://localhost:3000";
    const poll = renderPolled(() => {
      const r = row();
      r.snapshot!.lifecycle!.url = url;
      r.scannedAt = Date.now();
      return r;
    });
    const before = await screen.findByRole("link", { name: /open/i });
    url = "http://localhost:4000";
    poll();
    await settle();
    const after = screen.getByRole("link", { name: /open/i }) as HTMLAnchorElement;
    expect(after).toBe(before);
    expect(after.href).toContain("localhost:4000");
  });
});
