import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import SessionSummary from "../src/components/SessionSummary";

vi.mock("../src/api", () => ({
  getSessionSummary: vi.fn(),
  requestSessionSummary: vi.fn(),
}));

const api = await import("../src/api");
const getMock = () => api.getSessionSummary as ReturnType<typeof vi.fn>;
const postMock = () => api.requestSessionSummary as ReturnType<typeof vi.fn>;

const POLL_MS = 2000;
const MAX_POLLS = 60;

beforeEach(() => {
  getMock().mockReset();
  postMock().mockReset();
});

test("renders a ready summary and its moments", async () => {
  getMock().mockResolvedValue({
    status: "ready", summary: "It refactored the parser.",
    moments: [{ uuid: "u1", label: "found the bug" }], stale: false,
  });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("It refactored the parser."));
  expect(container.textContent).toContain("found the bug");
});

test("clicking a moment calls onJump with its uuid", async () => {
  getMock().mockResolvedValue({
    status: "ready", summary: "s", moments: [{ uuid: "u7", label: "the moment" }], stale: false,
  });
  const jumps: string[] = [];
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={(u) => jumps.push(u)} />
  ));
  await waitFor(() => expect(container.textContent).toContain("the moment"));
  fireEvent.click(getByText("the moment"));
  expect(jumps).toEqual(["u7"]);
});

test("absent + not live → requests generation and shows the pending state", async () => {
  getMock().mockResolvedValue({ status: "absent" });
  postMock().mockResolvedValue({ status: "pending" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title="Fix the parser" isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", false));
  expect(container.textContent).toContain("Fix the parser");
  expect(container.textContent?.toLowerCase()).toContain("summarizing");
});

test("a live session is not summarized automatically", async () => {
  getMock().mockResolvedValue({ status: "absent" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={true} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  expect(postMock()).not.toHaveBeenCalled();
  expect(container.querySelector("button")).not.toBeNull();
});

test("error shows the message and a retry that forces regeneration", async () => {
  getMock().mockResolvedValue({ status: "error", error: "claude exited 1" });
  postMock().mockResolvedValue({ status: "pending" });
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("claude exited 1"));
  fireEvent.click(getByText("Retry"));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", true));
});

test("stale shows a regenerate control alongside the old summary", async () => {
  getMock().mockResolvedValue({ status: "ready", summary: "old news", moments: [], stale: true });
  postMock().mockResolvedValue({ status: "pending" });
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("old news"));
  fireEvent.click(getByText("Regenerate"));
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", true));
});

test("skipped renders nothing", async () => {
  getMock().mockResolvedValue({ status: "skipped" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector(".session-summary")).toBeNull());
});

// --- polling-safety duties (a)-(d) ---

test("(a) unmounting clears the poll timer and issues no further requests", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "pending" });
    const { unmount } = render(() => (
      <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
    ));
    // let the first tick's fetch resolve and its follow-up timer get scheduled
    await vi.advanceTimersByTimeAsync(0);
    const callsAtUnmount = getMock().mock.calls.length;
    expect(callsAtUnmount).toBeGreaterThan(0);

    unmount();

    // advance well past several poll intervals — a leaked timer would keep firing
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(getMock().mock.calls.length).toBe(callsAtUnmount);
  } finally {
    vi.useRealTimers();
  }
});

test("(b) stops polling once the summary is ready", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "ready", summary: "done", moments: [], stale: false });
    render(() => <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />);
    await vi.advanceTimersByTimeAsync(0);
    const calls = getMock().mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(getMock().mock.calls.length).toBe(calls);
  } finally {
    vi.useRealTimers();
  }
});

test("(b) stops polling once the summary errors", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "error", error: "boom" });
    render(() => <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />);
    await vi.advanceTimersByTimeAsync(0);
    const calls = getMock().mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(getMock().mock.calls.length).toBe(calls);
  } finally {
    vi.useRealTimers();
  }
});

test("(c) the MAX_POLLS bound stops an always-pending poll loop", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "pending" });
    render(() => <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />);

    // advance well past MAX_POLLS worth of intervals
    await vi.advanceTimersByTimeAsync(POLL_MS * (MAX_POLLS + 5));
    const callsAtBound = getMock().mock.calls.length;

    // advancing further must not issue more calls
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(getMock().mock.calls.length).toBe(callsAtBound);

    // documented for the report: observed call count at the bound
    expect(callsAtBound).toBe(MAX_POLLS + 1);
  } finally {
    vi.useRealTimers();
  }
});

test("(d) no double-POST across the auto-generate poll loop for one mount", async () => {
  vi.useFakeTimers();
  try {
    // stays "absent" across several polls (simulating a slow-to-materialize
    // pending row on the server) before finally reporting "pending".
    getMock()
      .mockResolvedValueOnce({ status: "absent" })
      .mockResolvedValueOnce({ status: "absent" })
      .mockResolvedValueOnce({ status: "absent" })
      .mockResolvedValue({ status: "pending" });
    // POST resolves slowly, so it's still in flight while further polls happen.
    let resolvePost!: (v: unknown) => void;
    postMock().mockReturnValue(new Promise((r) => { resolvePost = r; }));

    render(() => <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />);

    await vi.advanceTimersByTimeAsync(POLL_MS * 6);
    expect(postMock().mock.calls.length).toBe(1);

    resolvePost({ status: "pending" });
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(postMock().mock.calls.length).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
