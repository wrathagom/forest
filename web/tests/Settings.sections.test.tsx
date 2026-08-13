import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { createResource, type Component } from "solid-js";
import { SettingsConfigContext, type ServerConfig } from "../src/lib/settings-config";
import ScanSection from "../src/components/settings/ScanSection";
import TerminalsSection from "../src/components/settings/TerminalsSection";
import LaunchersSection from "../src/components/settings/LaunchersSection";
import IntegrationsSection from "../src/components/settings/IntegrationsSection";
import SystemSection from "../src/components/settings/SystemSection";
import { patchConfig, runDiscover } from "../src/api";

const CONFIG: ServerConfig = {
  scanRoot: "/tmp/projects", pollIntervalMs: 10_000,
  sessionMaxTotal: 32, sessionMaxScrollbackLines: 10_000,
  sessionDefaultShell: "/bin/zsh", projectSubdirs: ["Personal"],
  launchers: [{ id: "shell", label: "shell", command: null, args: [] }],
  claudeConfigDirs: [{ path: "/home/u/.claude-work", profile: "work" }],
};

// IntegrationsSection renders BbsSettings, which fetches its own config.
const BBS_CONFIG = {
  enabled: false,
  baseUrl: "https://app.bigbeautifulscreens.com",
  screenId: null, screenUrl: null, accountKey: null, screenKey: null,
  alertLingerSec: 60, hudIntervalMs: 30_000, rotationIntervalSec: 8,
  hudPanelCap: 6, alertEvents: [], status: { lastOk: null, lastError: null },
};

vi.mock("../src/api", () => ({
  fetchConfig: vi.fn(async () => CONFIG),
  patchConfig: vi.fn(async () => ({ ok: true })),
  runDiscover: vi.fn(async () => ({ count: 3, root: "/tmp/projects" })),
  fetchBbsConfig: vi.fn(async () => BBS_CONFIG),
  saveBbsConfig: vi.fn(async () => ({ ok: true })),
  provisionBbs: vi.fn(async () => ({ ok: true })),
  testBbs: vi.fn(async () => ({ ok: true })),
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

  test("scan now runs discover without patching config", async () => {
    renderSection(ScanSection);
    const scan = await screen.findByRole("button", { name: "scan now" });
    fireEvent.click(scan);

    await waitFor(() => expect(runDiscover).toHaveBeenCalledOnce());
    expect(refetchProjects).toHaveBeenCalled();
    expect(patchConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/discovered 3 repos/i)).toBeTruthy());
  });

  test("scan now is enabled with no edits but disabled once dirty", async () => {
    renderSection(ScanSection);
    const scan = await screen.findByRole("button", { name: "scan now" });
    expect((scan as HTMLButtonElement).disabled).toBe(false);
    fireEvent.input(screen.getByLabelText("scan root"), { target: { value: "/tmp/other" } });
    expect((scan as HTMLButtonElement).disabled).toBe(true);
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

describe("LaunchersSection", () => {
  test("saves only the launcher list", async () => {
    renderSection(LaunchersSection);
    const label = await screen.findByDisplayValue("shell");
    fireEvent.input(label, { target: { value: "bash" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      launchers: [{ id: "shell", label: "bash", command: null, args: [] }],
    });
    expect(runDiscover).not.toHaveBeenCalled();
  });

  test("adding a launcher marks the section dirty", async () => {
    renderSection(LaunchersSection);
    const save = await screen.findByRole("button", { name: "save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ add launcher" }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("IntegrationsSection", () => {
  test("renders the BBS panel, which owns its own save buttons", async () => {
    renderSection(IntegrationsSection);
    expect(await screen.findByText("Big Beautiful Screens")).toBeTruthy();
    expect(
      await screen.findByPlaceholderText("https://app.bigbeautifulscreens.com"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "save" })).toBeNull();
  });
});

describe("SystemSection", () => {
  test("lists detected claude config dirs read-only", async () => {
    renderSection(SystemSection);
    expect(await screen.findByText("work")).toBeTruthy();
    expect(screen.getByText("/home/u/.claude-work")).toBeTruthy();
    expect(screen.queryByText("save")).toBeNull();
  });
});
