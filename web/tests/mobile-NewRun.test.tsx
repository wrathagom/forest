import { test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import { ProjectsContext } from "../src/projects-context";

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

const { launchAgentRun } = vi.hoisted(() => ({ launchAgentRun: vi.fn() }));
vi.mock("../src/api", () => ({ launchAgentRun }));

import NewRun from "../src/pages/mobile/NewRun";

function projectsCtx(rows = [{ id: "p1", name: "api", path: "/x/api", hidden: false }, { id: "p2", name: "dotfiles", path: "/x/dot", hidden: false }]) {
  const projects = Object.assign(() => ({ projects: rows, scanRoot: null, pollIntervalMs: 5000 }), { loading: false, error: undefined, latest: undefined, state: "ready" }) as never;
  return { projects, refetch: () => {} } as never;
}

function renderNewRun(ctx = projectsCtx()) {
  return render(() => (
    <ProjectsContext.Provider value={ctx}>
      <NewRun />
    </ProjectsContext.Provider>
  ));
}

beforeEach(() => { navigate.mockReset(); launchAgentRun.mockReset(); });

test("Launch is disabled until the prompt is non-empty", async () => {
  const { container } = renderNewRun();
  const btn = [...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? "")) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  const ta = container.querySelector("textarea")!;
  fireEvent.input(ta, { target: { value: "go fix CI" } });
  expect(btn.disabled).toBe(false);
});

test("submits projectId/prompt/permissionMode (default acceptEdits) and navigates to the new session", async () => {
  launchAgentRun.mockResolvedValue({ sessionId: "new-sid" });
  const { container } = renderNewRun();
  fireEvent.input(container.querySelector("textarea")!, { target: { value: "go fix CI" } });
  fireEvent.click([...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? ""))!);
  await waitFor(() => expect(launchAgentRun).toHaveBeenCalled());
  expect(launchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", prompt: "go fix CI", permissionMode: "acceptEdits" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/m/s/new-sid"));
});

test("choosing 'Full auto' changes the submitted permissionMode", async () => {
  launchAgentRun.mockResolvedValue({ sessionId: "x" });
  const { container } = renderNewRun();
  fireEvent.input(container.querySelector("textarea")!, { target: { value: "do it" } });
  fireEvent.click([...container.querySelectorAll(".m-seg button")].find((b) => /full auto/i.test(b.textContent ?? ""))!);
  fireEvent.click([...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? ""))!);
  await waitFor(() => expect(launchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "bypassPermissions" })));
});

test("selecting a different project changes the submitted projectId", async () => {
  launchAgentRun.mockResolvedValue({ sessionId: "x" });
  const { container } = renderNewRun();
  expect(container.querySelector('option[value="p2"]')).toBeTruthy();
  fireEvent.change(container.querySelector("select")!, { target: { value: "p2" } });
  fireEvent.input(container.querySelector("textarea")!, { target: { value: "hi" } });
  fireEvent.click([...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? ""))!);
  await waitFor(() => expect(launchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p2" })));
});

test("shows an error and stays put when launch fails", async () => {
  launchAgentRun.mockRejectedValue(new Error("checkout missing: /x/api"));
  const { container } = renderNewRun();
  fireEvent.input(container.querySelector("textarea")!, { target: { value: "go" } });
  fireEvent.click([...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? ""))!);
  await waitFor(() => expect(container.querySelector(".m-error")?.textContent).toContain("checkout missing"));
  expect(navigate).not.toHaveBeenCalled();
});

test("button shows 'Launching…' and is disabled while launch is in-flight", async () => {
  let resolveLaunch!: (v: any) => void;
  launchAgentRun.mockReturnValue(new Promise(r => { resolveLaunch = r; }));
  const { container } = renderNewRun();
  fireEvent.input(container.querySelector("textarea")!, { target: { value: "go" } });
  const btn = [...container.querySelectorAll("button")].find((b) => /launch run/i.test(b.textContent ?? "")) as HTMLButtonElement;
  fireEvent.click(btn);
  await waitFor(() => expect(btn.textContent).toBe("Launching…"));
  expect(btn.disabled).toBe(true);
  resolveLaunch({ sessionId: "x" });
  await waitFor(() => expect(navigate).toHaveBeenCalled());
});
