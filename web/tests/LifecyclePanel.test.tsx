import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import LifecyclePanel from "../src/components/LifecyclePanel";
import * as api from "../src/api";

describe("LifecyclePanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("shows an enable action when a forest.yaml is present but disabled", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: false, config: { start: "make up" }, status: "none", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" />);
    expect(await screen.findByRole("button", { name: /enable lifecycle/i })).toBeTruthy();
  });

  test("shows Start/Stop when enabled with commands", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up", stop: "make down" }, status: "stopped", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" />);
    expect(await screen.findByRole("button", { name: /^start$/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^stop$/i })).toBeTruthy();
  });

  test("hint when there is no forest.yaml", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: false, enabled: false, config: null, status: "none", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" />);
    expect(await screen.findByText(/forest\.yaml/i)).toBeTruthy();
  });

  test("clicking Start calls the api", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped", lastRun: null,
    });
    const start = vi.spyOn(api, "startLifecycle").mockResolvedValue({ exitCode: 0, output: "ok", timedOut: false, failed: false });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("p"));
  });

  test("clicking Stop calls the api", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up", stop: "make down" }, status: "running", lastRun: null,
    });
    const stop = vi.spyOn(api, "stopLifecycle").mockResolvedValue({ exitCode: 0, output: "ok", timedOut: false, failed: false });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /^stop$/i }));
    await waitFor(() => expect(stop).toHaveBeenCalledWith("p"));
  });

  test("surfaces an action error and re-enables the button", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped", lastRun: null,
    });
    vi.spyOn(api, "startLifecycle").mockRejectedValue(new Error("boom"));
    render(() => <LifecyclePanel projectId="p" />);
    const btn = await screen.findByRole("button", { name: /^start$/i });
    fireEvent.click(btn);
    expect(await screen.findByText(/boom/i)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: /^start$/i }) as HTMLButtonElement).disabled).toBe(false));
  });

  test("optimistically shows 'starting' immediately on click", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped", lastRun: null,
    });
    let resolveStart!: (v: api.LifecycleRunResult) => void;
    vi.spyOn(api, "startLifecycle").mockReturnValue(new Promise((r) => { resolveStart = r; }));
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByText("starting")).toBeTruthy();
    resolveStart({ exitCode: 0, output: "ok", timedOut: false, failed: false });
  });

  test("shows an Open link when the app is up", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true,
      config: { start: "make up", url: "http://localhost:3000" }, status: "running", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" />);
    const link = await screen.findByRole("link", { name: /open/i });
    expect((link as HTMLAnchorElement).href).toContain("localhost:3000");
    expect((link as HTMLAnchorElement).target).toBe("_blank");
  });

  test("hides the Open link when stopped even with a url configured", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true,
      config: { start: "make up", url: "http://localhost:3000" }, status: "stopped", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" />);
    await screen.findByRole("button", { name: /^start$/i });
    expect(screen.queryByRole("link", { name: /open/i })).toBeNull();
  });

  test("clears the error banner when switching projects", async () => {
    const [id, setId] = createSignal("p1");
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped", lastRun: null,
    });
    vi.spyOn(api, "startLifecycle").mockRejectedValue(new Error("boom"));
    render(() => <LifecyclePanel projectId={id()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByText(/boom/i)).toBeTruthy();
    setId("p2");
    await waitFor(() => expect(screen.queryByText(/boom/i)).toBeNull());
  });

  test("renders a section row with a status chip, Start, and Stop", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [
        { name: "game", config: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" }, status: "healthy", lastRun: null },
      ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    expect(await screen.findByText("game")).toBeTruthy();
    expect(await screen.findByText("healthy")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /start game/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /stop game/i })).toBeTruthy();
  });

  test("hides the chip for a launcher section with status none", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [
        { name: "editor", config: { start: "godot --editor ." }, status: "none", lastRun: null },
      ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    expect(await screen.findByText("editor")).toBeTruthy();
    expect(screen.queryByText("none")).toBeNull();
  });

  test("clicking a section Start calls startSection with the section name", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [
        { name: "game", config: { start: "godot ." }, status: "none", lastRun: null },
      ],
    });
    const startSection = vi.spyOn(api, "startSection").mockResolvedValue({ exitCode: 0, output: "ok", timedOut: false, failed: false });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /start game/i }));
    await waitFor(() => expect(startSection).toHaveBeenCalledWith("p", "game"));
  });

  test("optimistically shows a section's 'starting' immediately on click", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [ { name: "game", config: { start: "godot ." }, status: "none", lastRun: null } ],
    });
    let resolveStart!: (v: api.LifecycleRunResult) => void;
    vi.spyOn(api, "startSection").mockReturnValue(new Promise((r) => { resolveStart = r; }));
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /start game/i }));
    expect(await screen.findByText("starting")).toBeTruthy();
    resolveStart({ exitCode: 0, output: "ok", timedOut: false, failed: false });
  });

  test("shows a launcher section's Open link even without a health command", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [ { name: "game", config: { start: "godot .", url: "http://localhost:8060" }, status: "none", lastRun: null } ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    const links = await screen.findAllByRole("link", { name: /open/i });
    expect(links.some((l) => (l as HTMLAnchorElement).href.includes("localhost:8060"))).toBe(true);
  });

  test("shows a section Open link for a healthy section with a url", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [
        { name: "game", config: { start: "godot .", url: "http://localhost:8060", health: "pgrep -f godot" }, status: "healthy", lastRun: null },
      ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    const links = await screen.findAllByRole("link", { name: /open/i });
    expect(links.some((l) => (l as HTMLAnchorElement).href.includes("localhost:8060"))).toBe(true);
  });

  test("does not render section rows when lifecycle is not enabled", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: false, config: { start: "make up" }, status: "none", lastRun: null,
      sections: [
        { name: "game", config: { start: "godot .", health: "pgrep -f godot" }, status: "none", lastRun: null },
      ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    // Enable button is present; the section name is not rendered while disabled.
    await screen.findByRole("button", { name: /enable lifecycle/i });
    expect(screen.queryByText("game")).toBeNull();
  });

  test("a section run does not populate the top-level last-run output", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [ { name: "game", config: { start: "godot ." }, status: "none", lastRun: null } ],
    });
    const startSection = vi.spyOn(api, "startSection").mockResolvedValue({ exitCode: 0, output: "GAME-OUTPUT", timedOut: false, failed: false });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /start game/i }));
    await waitFor(() => expect(startSection).toHaveBeenCalled());
    // The section's output must NOT surface in the shared top-level last-run panel.
    await waitFor(() => expect(screen.queryByText("GAME-OUTPUT")).toBeNull());
  });
});
