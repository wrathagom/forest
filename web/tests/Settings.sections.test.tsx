import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { createResource, type Component } from "solid-js";
import { SettingsConfigContext, type ServerConfig } from "../src/lib/settings-config";
import ScanSection from "../src/components/settings/ScanSection";
import TerminalsSection from "../src/components/settings/TerminalsSection";
import { patchConfig, runDiscover } from "../src/api";

const CONFIG: ServerConfig = {
  scanRoot: "/tmp/projects", pollIntervalMs: 10_000,
  sessionMaxTotal: 32, sessionMaxScrollbackLines: 10_000,
  sessionDefaultShell: "/bin/zsh", projectSubdirs: ["Personal"], launchers: [],
  claudeConfigDirs: [],
};

vi.mock("../src/api", () => ({
  fetchConfig: vi.fn(async () => CONFIG),
  patchConfig: vi.fn(async () => ({ ok: true })),
  runDiscover: vi.fn(async () => ({ count: 3, root: "/tmp/projects" })),
}));

const refetchProjects = vi.fn();
vi.mock("../src/projects-context", () => ({
  useProjects: () => ({ projects: () => [], refetch: refetchProjects }),
}));

// NOTE: `<Router url=...>` does nothing here — `url` is a StaticRouter/SSR
// prop, and the browser Router reads window.location. Set the location first
// or every test renders at "/" and matches no route.
function renderSection(Section: Component) {
  window.history.replaceState(null, "", "/settings/x");
  const [config, { refetch }] = createResource(async () => CONFIG);
  return render(() => (
    <Router>
      <Route
        path="/settings/x"
        component={() => (
          <SettingsConfigContext.Provider value={{ config, refetch }}>
            <Section />
          </SettingsConfigContext.Provider>
        )}
      />
    </Router>
  ));
}

beforeEach(() => vi.clearAllMocks());

describe("ScanSection", () => {
  test("saves only its own fields and runs discover", async () => {
    renderSection(ScanSection);
    const root = await screen.findByLabelText("scan root");
    fireEvent.input(root, { target: { value: "/tmp/other" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      scanRoot: "/tmp/other",
      pollIntervalMs: 10_000,
      projectSubdirs: ["Personal"],
    });
    await waitFor(() => expect(runDiscover).toHaveBeenCalledOnce());
    expect(refetchProjects).toHaveBeenCalled();
  });

  test("does not navigate away after saving", async () => {
    renderSection(ScanSection);
    const root = await screen.findByLabelText("scan root");
    fireEvent.input(root, { target: { value: "/tmp/other" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByText(/^saved/i)).toBeTruthy());
    expect(screen.getByLabelText("scan root")).toBeTruthy();
  });
});

describe("TerminalsSection", () => {
  test("saves only terminal fields and does not run discover", async () => {
    renderSection(TerminalsSection);
    const shell = await screen.findByLabelText("default shell");
    fireEvent.input(shell, { target: { value: "/bin/fish" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      sessionMaxTotal: 32,
      sessionMaxScrollbackLines: 10_000,
      sessionDefaultShell: "/bin/fish",
    });
    expect(runDiscover).not.toHaveBeenCalled();
  });

  test("save is disabled until something changes", async () => {
    renderSection(TerminalsSection);
    const save = await screen.findByRole("button", { name: "save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("default shell"), { target: { value: "/bin/fish" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
