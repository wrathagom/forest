import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Router, Route, Navigate } from "@solidjs/router";
import Settings from "../src/pages/Settings";

vi.mock("../src/api", () => ({
  fetchConfig: vi.fn(async () => ({
    scanRoot: "/tmp/projects", pollIntervalMs: 10_000,
    sessionMaxTotal: 32, sessionMaxScrollbackLines: 10_000,
    sessionDefaultShell: "/bin/zsh", projectSubdirs: [], launchers: [],
    claudeConfigDirs: [],
  })),
  patchConfig: vi.fn(async () => ({ ok: true })),
  runDiscover: vi.fn(async () => ({ count: 0, root: "/tmp/projects" })),
}));

vi.mock("../src/projects-context", () => ({
  useProjects: () => ({ projects: () => [], refetch: vi.fn() }),
}));

function renderAt(path: string) {
  // The browser Router reads window.location, so seed it before rendering.
  window.history.replaceState(null, "", path);
  return render(() => (
    <Router>
      <Route path="/settings" component={Settings}>
        <Route path="/" component={() => <Navigate href="/settings/appearance" />} />
        <Route path="/appearance" component={() => <div>appearance-pane</div>} />
        <Route path="/scan" component={() => <div>scan-pane</div>} />
      </Route>
    </Router>
  ));
}

beforeEach(() => localStorage.clear());

describe("settings shell", () => {
  test("renders the rail with every section", async () => {
    renderAt("/settings/appearance");
    for (const label of [
      "appearance", "dashboard", "scan", "terminals", "launchers", "integrations", "system",
    ]) {
      expect(await screen.findByRole("link", { name: label })).toBeTruthy();
    }
  });

  test("renders the routed section in the pane", async () => {
    renderAt("/settings/scan");
    expect(await screen.findByText("scan-pane")).toBeTruthy();
  });

  test("bare /settings redirects to appearance", async () => {
    renderAt("/settings");
    expect(await screen.findByText("appearance-pane")).toBeTruthy();
  });
});
