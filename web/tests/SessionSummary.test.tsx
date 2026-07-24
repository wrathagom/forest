import { test, expect, vi, beforeEach } from "vitest";
import { createSignal } from "solid-js";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import SessionSummary, { POLL_MS, MAX_POLLS } from "../src/components/SessionSummary";

vi.mock("../src/api", () => ({
  getSessionSummary: vi.fn(),
  requestSessionSummary: vi.fn(),
}));

const api = await import("../src/api");
const getMock = () => api.getSessionSummary as ReturnType<typeof vi.fn>;
const postMock = () => api.requestSessionSummary as ReturnType<typeof vi.fn>;

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
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={true} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  expect(postMock()).not.toHaveBeenCalled();
  await waitFor(() => expect(getByText("Summarize")).toBeTruthy());
  expect(container.textContent?.toLowerCase()).not.toContain("summarizing…");
});

test("error shows the message and a retry that lands on the finished summary", async () => {
  vi.useFakeTimers();
  try {
    // The retry leaves the server working; the next poll finds it done.
    getMock()
      .mockResolvedValueOnce({ status: "error", error: "claude exited 1" })
      .mockResolvedValue({ status: "ready", summary: "the retry worked", moments: [], stale: false });
    postMock().mockResolvedValue({ status: "pending" });
    const { container, getByText } = render(() => (
      <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent).toContain("claude exited 1");

    fireEvent.click(getByText("Retry"));
    await vi.advanceTimersByTimeAsync(0);
    expect(postMock()).toHaveBeenCalledWith("s1", true);

    // …and the user actually ends up looking at the new summary.
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(container.textContent).toContain("the retry worked");
    expect(container.textContent?.toLowerCase()).not.toContain("summarizing…");
  } finally {
    vi.useRealTimers();
  }
});

test("stale regeneration lands on the fresh summary", async () => {
  vi.useFakeTimers();
  try {
    getMock()
      .mockResolvedValueOnce({ status: "ready", summary: "old news", moments: [], stale: true })
      .mockResolvedValue({ status: "ready", summary: "fresh news", moments: [], stale: false });
    postMock().mockResolvedValue({ status: "pending" });
    const { container, getByText } = render(() => (
      <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent).toContain("old news");

    fireEvent.click(getByText("Regenerate"));
    await vi.advanceTimersByTimeAsync(0);
    expect(postMock()).toHaveBeenCalledWith("s1", true);

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(container.textContent).toContain("fresh news");
    expect(container.textContent).not.toContain("old news");
  } finally {
    vi.useRealTimers();
  }
});

test("skipped renders nothing", async () => {
  getMock().mockResolvedValue({ status: "skipped" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector(".session-summary")).toBeNull());
});

test("skipped keeps the session title — only the summary parts go away", async () => {
  getMock().mockResolvedValue({ status: "skipped" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title="Fix the parser" isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent?.toLowerCase()).not.toContain("summarizing"));
  expect(container.textContent).toContain("Fix the parser");
});

test("an error row with no message does not render a dangling colon", async () => {
  getMock().mockResolvedValue({ status: "error", error: null });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("summary failed"));
  expect(container.textContent).toContain("unknown error");
});

test("the error state is marked up as an error, not as muted prose", async () => {
  getMock().mockResolvedValue({ status: "error", error: "claude exited 1" });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("claude exited 1"));
  const row = container.querySelector(".session-summary-error")!;
  expect(row).not.toBeNull();
  expect(row.querySelector(".muted")).toBeNull();
});

test("the pending→ready transition sits in a live region", async () => {
  getMock().mockResolvedValue({ status: "ready", summary: "announced", moments: [], stale: false });
  const { container } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("announced"));
  const live = container.querySelector('[role="status"]');
  expect(live).not.toBeNull();
  expect(live!.textContent).toContain("announced");
});

test("an in-flight retry disables the control and says so", async () => {
  getMock().mockResolvedValue({ status: "error", error: "boom" });
  let resolvePost!: (v: unknown) => void;
  postMock().mockReturnValue(new Promise((r) => { resolvePost = r; }));
  const { container, getByText } = render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("boom"));
  const btn = getByText("Retry") as HTMLButtonElement;
  expect(btn.disabled).toBe(false);

  fireEvent.click(btn);
  await waitFor(() => expect(container.textContent).toContain("retrying…"));
  const busyBtn = container.querySelector(".session-summary-action") as HTMLButtonElement;
  expect(busyBtn.disabled).toBe(true);

  resolvePost({ status: "pending" });
});

test("polling that never finishes gives up with an honest message and a retry", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "pending" });
    const { container } = render(() => (
      <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
    ));
    await vi.advanceTimersByTimeAsync(POLL_MS * (MAX_POLLS + 2));

    // "summarizing…" would be a lie: nothing is being polled any more.
    expect(container.textContent?.toLowerCase()).not.toContain("summarizing…");
    expect(container.textContent).toContain("stopped waiting");
    const retry = container.querySelector(".session-summary-action") as HTMLButtonElement;
    expect(retry).not.toBeNull();
    expect(retry.textContent).toContain("Retry");

    // that retry is the only recovery path — a failure on it must surface as the
    // failure, not leave the stale "stopped waiting" copy in place
    postMock().mockRejectedValue(new Error("network down"));
    fireEvent.click(retry);
    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent).toContain("network down");
    expect(container.textContent).not.toContain("stopped waiting");
  } finally {
    vi.useRealTimers();
  }
});

test("a server stuck on 'absent' gives up rather than pretending to summarize", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockResolvedValue({ status: "absent" });
    postMock().mockResolvedValue({ status: "absent" });
    const { container } = render(() => (
      <SessionSummary sessionId="s1" title={null} isLive={false} onJump={() => {}} />
    ));
    await vi.advanceTimersByTimeAsync(POLL_MS * (MAX_POLLS + 2));
    expect(container.textContent).toContain("stopped waiting");
  } finally {
    vi.useRealTimers();
  }
});

test("changing sessionId clears the previous session's summary", async () => {
  vi.useFakeTimers();
  try {
    getMock().mockImplementation(async (id: string) =>
      id === "s1"
        ? { status: "ready", summary: "first session summary", moments: [], stale: false }
        : { status: "pending" },
    );
    const [id, setId] = createSignal("s1");
    const { container } = render(() => (
      <SessionSummary sessionId={id()} title={null} isLive={false} onJump={() => {}} />
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent).toContain("first session summary");

    setId("s2");
    // the stale summary must not linger while the new session's GET is in flight
    expect(container.textContent).not.toContain("first session summary");

    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent?.toLowerCase()).toContain("summarizing");
  } finally {
    vi.useRealTimers();
  }
});

test("isLive flipping to false starts the auto-generation it was suppressing", async () => {
  getMock().mockResolvedValue({ status: "absent" });
  postMock().mockResolvedValue({ status: "pending" });
  const [live, setLive] = createSignal(true);
  render(() => (
    <SessionSummary sessionId="s1" title={null} isLive={live()} onJump={() => {}} />
  ));
  await waitFor(() => expect(getMock()).toHaveBeenCalled());
  expect(postMock()).not.toHaveBeenCalled();

  setLive(false);
  await waitFor(() => expect(postMock()).toHaveBeenCalledWith("s1", false));
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
