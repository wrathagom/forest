import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
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
});
