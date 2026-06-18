import { test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import type { LiveSessionRow } from "../src/api";

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

const { fetchLiveSessions } = vi.hoisted(() => ({
  fetchLiveSessions: vi.fn(),
}));
vi.mock("../src/api", () => ({ fetchLiveSessions }));

import SessionBar from "../src/components/SessionBar";

// Default factory row: a live Forest-launched session (has a ptySessionId, no endedAt).
const liveRow = (over: Partial<LiveSessionRow> = {}) => ({
  agentSessionId: "abcdef12-3456-7890-aaaa-bbbbbbbbbbbb",
  parentSessionId: null,
  projectId: "p1",
  projectName: "Proj One",
  cwd: "/p1",
  worktreeLabel: "main",
  branch: null,
  ptySessionId: "pty-1",
  state: "working",
  endedAt: null,
  startedAt: Date.now() - 60_000,
  lastEventAt: Date.now() - 5_000,
  lastUserMsg: "build the thing",
  ...over,
});
// A Forest session whose terminal has exited (closed).
const closedRow = (over: Partial<LiveSessionRow> = {}) =>
  liveRow({ ptySessionId: "pty-old", endedAt: Date.now() - 1_000, state: "stale", ...over });

beforeEach(() => {
  navigate.mockReset();
  fetchLiveSessions.mockReset();
});

test("renders nothing when there are no live sessions", async () => {
  fetchLiveSessions.mockResolvedValue({ sessions: [] });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(fetchLiveSessions).toHaveBeenCalled());
  expect(container.querySelector(".session-bar")).toBeNull();
});

test("renders a chip per session with its state class and project name", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow(),
      liveRow({ agentSessionId: "z", ptySessionId: "pty-2", projectId: "p2", projectName: "Two", state: "waiting", lastUserMsg: null }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelectorAll(".session-chip")).toHaveLength(2));
  expect(container.querySelector(".session-chip-working")).toBeTruthy();
  expect(container.querySelector(".session-chip-waiting")).toBeTruthy();
  expect(container.textContent).toContain("Proj One");
  expect(container.textContent).toContain("Two");
  // the prompt is in the tooltip, not the chip body
  expect(container.textContent).not.toContain("build the thing");
  expect(container.querySelector(".session-chip")?.getAttribute("title")).toContain("build the thing");
});

test("clicking a live Forest chip navigates to ?term= (focuses its terminal)", async () => {
  fetchLiveSessions.mockResolvedValue({ sessions: [liveRow({ ptySessionId: "pty-9" })] });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip")!);
  expect(navigate).toHaveBeenCalledWith("/projects/p1?term=pty-9");
});

test("clicking a closed Forest chip opens the session reader", async () => {
  fetchLiveSessions.mockResolvedValue({ sessions: [closedRow()] });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip")!);
  expect(navigate).toHaveBeenCalledWith("/projects/p1?session=abcdef12-3456-7890-aaaa-bbbbbbbbbbbb");
});

test("clicking an external session with a project opens the session reader", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [liveRow({ ptySessionId: null, agentSessionId: "ext-1" })],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip")!);
  expect(navigate).toHaveBeenCalledWith("/projects/p1?session=ext-1");
});

test("closed chip dot uses the closed class, not the underlying state class", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow(), // open: state=working
      closedRow({ ptySessionId: "pty-c", projectId: "p3", projectName: "Three", state: "stale" }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelectorAll(".session-chip")).toHaveLength(2));
  // open session keeps its state dot
  expect(container.querySelector(".session-chip-dot-working")).toBeTruthy();
  // closed session shows the closed dot, NOT its (last-known) stale dot
  expect(container.querySelector(".session-chip-dot-closed")).toBeTruthy();
  expect(container.querySelector(".session-chip-dot-stale")).toBeNull();
});

test("a session with no project is inert (shown but not clickable)", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow({ agentSessionId: "u", ptySessionId: "pty-z", projectId: null, projectName: null }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  expect(container.querySelectorAll(".session-chip-inert")).toHaveLength(1);
  for (const chip of container.querySelectorAll(".session-chip")) fireEvent.click(chip);
  expect(navigate).not.toHaveBeenCalled();
});

test("shows profile badge for non-default profile, hides badge for default profile", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow({ agentSessionId: "sess-work", profile: "work", state: "waiting" }),
      liveRow({ agentSessionId: "sess-default", ptySessionId: "pty-2", profile: "default", state: "waiting" }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelectorAll(".session-chip")).toHaveLength(2));
  expect(container.querySelector(".session-profile-badge")?.textContent).toBe("work");
  expect(container.textContent).not.toContain("default");
});
