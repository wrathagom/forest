import { test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import type { LiveSessionRow } from "../src/api";

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

const { fetchLiveSessions, markSessionDone } = vi.hoisted(() => ({
  fetchLiveSessions: vi.fn(),
  markSessionDone: vi.fn(),
}));
vi.mock("../src/api", () => ({ fetchLiveSessions, markSessionDone }));

import SessionBar from "../src/components/SessionBar";

// Default factory row: a live Forest-launched session (has a ptySessionId, no endedAt).
const liveRow = (over: Partial<LiveSessionRow> = {}) => ({
  agent: "claude",
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
  markSessionDone.mockReset();
  markSessionDone.mockResolvedValue(undefined);
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

test("clicking a live Codex chip navigates to ?term= (focuses its terminal)", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [liveRow({ agent: "codex", agentSessionId: "cx-1", ptySessionId: "pty-cx" })],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  const chip = container.querySelector(".session-chip")!;
  expect(chip.classList.contains("session-chip-inert")).toBe(false);
  expect(chip.getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(chip);
  expect(navigate).toHaveBeenCalledWith("/projects/p1?term=pty-cx");
});

test("a closed Codex chip is inert (no dead transcript reader)", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow({
        agent: "codex",
        agentSessionId: "cx-2",
        ptySessionId: null,
        endedAt: Date.now() - 1_000,
        state: "stale",
      }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  const chip = container.querySelector(".session-chip")!;
  expect(chip.classList.contains("session-chip-inert")).toBe(true);
  // Deliberately not `disabled` — a disabled button drops out of the tab order,
  // which would also make the sibling remove-× unreachable via :focus-within.
  // aria-disabled keeps it focusable while onChipClick still no-ops the click.
  expect(chip.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(chip);
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

test("only closed chips render a remove button", async () => {
  fetchLiveSessions.mockResolvedValue({
    sessions: [
      liveRow(), // working — not closed
      closedRow({ agentSessionId: "c1", ptySessionId: "pty-c1", projectId: "p2", projectName: "Two" }),
    ],
  });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelectorAll(".session-chip")).toHaveLength(2));
  expect(container.querySelectorAll(".session-chip-remove")).toHaveLength(1);
});

test("clicking the remove x dismisses a closed session and removes its chip optimistically", async () => {
  fetchLiveSessions.mockResolvedValue({ sessions: [closedRow()] });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip-remove")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip-remove")!);
  // optimistic: the chip vanishes immediately, without waiting on the network call to resolve
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeNull());
  expect(markSessionDone).toHaveBeenCalledWith("abcdef12-3456-7890-aaaa-bbbbbbbbbbbb");
});

test("a failed dismissal restores the chip", async () => {
  markSessionDone.mockRejectedValue(new Error("network error"));
  fetchLiveSessions.mockResolvedValue({ sessions: [closedRow()] });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip-remove")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip-remove")!);
  // optimistic removal happens first, regardless of how the request resolves
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeNull());
  // once the rejection is handled, the chip comes back so the user can retry
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
});

test("a session removed while closed reappears once revived (no longer closed)", async () => {
  const sessionId = "revive-1";
  fetchLiveSessions
    .mockResolvedValueOnce({
      sessions: [closedRow({ agentSessionId: sessionId, ptySessionId: "pty-r" })],
    })
    .mockResolvedValueOnce({
      // server "un-dismissed" it on a new prompt: same id, live again, not closed
      sessions: [liveRow({ agentSessionId: sessionId, ptySessionId: "pty-r-new", state: "working" })],
    });
  const { container } = render(() => <SessionBar />);
  await waitFor(() => expect(container.querySelector(".session-chip-remove")).toBeTruthy());
  fireEvent.click(container.querySelector(".session-chip-remove")!);
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeNull());
  // markSessionDone resolves, refetch() runs, and the row comes back not-closed —
  // the `removed` set still has the id, but the `&& isClosed(s)` guard no longer applies.
  await waitFor(() => expect(container.querySelector(".session-chip")).toBeTruthy());
  expect(container.querySelector(".session-chip-remove")).toBeNull();
});
