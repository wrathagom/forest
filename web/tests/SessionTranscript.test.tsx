import { test, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import SessionTranscript from "../src/components/SessionTranscript";

vi.mock("../src/api", () => ({
  getSessionSummary: vi.fn(async () => ({ status: "skipped" })),
  requestSessionSummary: vi.fn(async () => ({ status: "skipped" })),
  getAgentSessionDetail: vi.fn(async () => ({
    session: {
      session_id: "s1", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: "feat", cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 2, first_user_msg: "hi",
    },
    messages: [
      { id: 1, role: "user", content: '{"type":"user"}', timestamp: 0, model: null,
        input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
        output_tokens: null, stop_reason: null },
      { id: 2, role: "assistant", content: "{}", timestamp: 1, model: "claude-opus-4-7",
        input_tokens: 100, cache_create_tokens: 0, cache_read_tokens: 0,
        output_tokens: 5, stop_reason: "end_turn" },
    ],
    toolCalls: [], events: [],
  })),
}));

test("renders message list and totals (tokens, tool calls)", async () => {
  const { container } = render(() => (
    <SessionTranscript sessionId="s1" onResume={() => {}} />
  ));
  await waitFor(() => container.textContent?.includes("claude-opus-4-7"));
  expect(container.textContent).toContain("105"); // 100 + 5
  expect(container.textContent).toContain("0 tool calls");
});

test("suppresses messages whose content parses to zero displayable blocks", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s3", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 3, first_user_msg: null,
    },
    messages: [
      // permission-mode / file-history-snapshot style: no message.content → empty blocks
      { id: 1, role: "permission-mode", content: '{"type":"permission-mode"}', timestamp: 0, model: null,
        input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
        output_tokens: null, stop_reason: null },
      { id: 2, role: "file-history-snapshot", content: '{"type":"file-history-snapshot"}', timestamp: 0, model: null,
        input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
        output_tokens: null, stop_reason: null },
      // real prompt
      { id: 3, role: "user", content: '{"type":"user","message":{"role":"user","content":"hello there"}}', timestamp: 1, model: null,
        input_tokens: null, cache_create_tokens: null, cache_read_tokens: null,
        output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });
  const { container } = render(() => (
    <SessionTranscript sessionId="s3" onResume={() => {}} />
  ));
  await waitFor(() => container.textContent?.includes("hello there"));
  expect(container.querySelectorAll("li.msg")).toHaveLength(1);
  expect(container.textContent).not.toContain("permission-mode");
  expect(container.textContent).not.toContain("file-history-snapshot");
});

test("each rendered message carries its uuid for anchoring", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s4", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u-anchor", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"anchor me"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });
  const { container } = render(() => <SessionTranscript sessionId="s4" onResume={() => {}} />);
  await waitFor(() => container.textContent?.includes("anchor me"));
  expect(container.querySelector('[data-msg-uuid="u-anchor"]')).not.toBeNull();
});

test("a filtered-out message (zero displayable blocks) contributes no data-msg-uuid node", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s5", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 2, first_user_msg: null, title: null,
    },
    messages: [
      // filtered out: parses to zero displayable blocks, yet still carries a uuid
      { id: 1, uuid: "u-filtered", role: "permission-mode", content: '{"type":"permission-mode"}',
        timestamp: 0, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
      // survives the filter
      { id: 2, uuid: "u-visible", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"hello there"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });
  const { container } = render(() => <SessionTranscript sessionId="s5" onResume={() => {}} />);
  await waitFor(() => container.textContent?.includes("hello there"));
  // A "key moment" anchor pointing at the filtered message's uuid would find nothing.
  expect(container.querySelector('[data-msg-uuid="u-filtered"]')).toBeNull();
  expect(container.querySelector('[data-msg-uuid="u-visible"]')).not.toBeNull();
});

test("a null uuid renders no data-msg-uuid attribute at all (not the string \"undefined\")", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s6", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: null, role: "user",
        content: '{"type":"user","message":{"role":"user","content":"no uuid here"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });
  const { container } = render(() => <SessionTranscript sessionId="s6" onResume={() => {}} />);
  await waitFor(() => container.textContent?.includes("no uuid here"));
  expect(container.querySelector('[data-msg-uuid]')).toBeNull();
  const li = container.querySelector("li.msg")!;
  expect(li.getAttribute("data-msg-uuid")).toBeNull();
  expect(li.outerHTML).not.toContain("undefined");
});

test("jumping to a moment scrolls that message into view and flashes it", async () => {
  const api = await import("../src/api");
  (api.getSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "ready", summary: "a summary", moments: [{ uuid: "u-anchor", label: "the moment" }],
    stale: false,
  });
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s5", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u-anchor", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"anchor me"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });

  const { container, getByText } = render(() => (
    <SessionTranscript sessionId="s5" onResume={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("the moment"));

  const target = container.querySelector('[data-msg-uuid="u-anchor"]') as HTMLElement;
  const scrolled: unknown[] = [];
  target.scrollIntoView = ((opts: unknown) => scrolled.push(opts)) as never;

  fireEvent.click(getByText("the moment"));
  expect(scrolled).toHaveLength(1);
  expect(target.classList.contains("msg-flash")).toBe(true);
});

test("jumping to a moment whose uuid matches no rendered message does nothing", async () => {
  const api = await import("../src/api");
  (api.getSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "ready", summary: "a summary",
    moments: [{ uuid: "u-missing", label: "a moment for a filtered message" }],
    stale: false,
  });
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s7", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      // survives the filter, but its uuid does not match the moment above
      { id: 1, uuid: "u-visible", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"hello there"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });

  const { container, getByText } = render(() => (
    <SessionTranscript sessionId="s7" onResume={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("a moment for a filtered message"));

  const target = container.querySelector('[data-msg-uuid="u-visible"]') as HTMLElement;
  const scrolled: unknown[] = [];
  target.scrollIntoView = ((opts: unknown) => scrolled.push(opts)) as never;

  expect(() => fireEvent.click(getByText("a moment for a filtered message"))).not.toThrow();
  expect(scrolled).toHaveLength(0);
  expect(target.classList.contains("msg-flash")).toBe(false);
});

test("jumping with a hostile uuid does not become a selector injection", async () => {
  const api = await import("../src/api");
  const hostile = 'u1"], [data-msg-uuid="u2';
  (api.getSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "ready", summary: "a summary",
    moments: [{ uuid: hostile, label: "sketchy moment" }],
    stale: false,
  });
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s8", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 2, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u1", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"first"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
      { id: 2, uuid: "u2", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"second"}}',
        timestamp: 2, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });

  const { container, getByText } = render(() => (
    <SessionTranscript sessionId="s8" onResume={() => {}} />
  ));
  await waitFor(() => expect(container.textContent).toContain("sketchy moment"));

  const u1 = container.querySelector('[data-msg-uuid="u1"]') as HTMLElement;
  const u2 = container.querySelector('[data-msg-uuid="u2"]') as HTMLElement;
  const scrolled: unknown[] = [];
  u1.scrollIntoView = ((opts: unknown) => scrolled.push(opts)) as never;
  u2.scrollIntoView = ((opts: unknown) => scrolled.push(opts)) as never;

  expect(() => fireEvent.click(getByText("sketchy moment"))).not.toThrow();
  expect(scrolled).toHaveLength(0);
  expect(u1.classList.contains("msg-flash")).toBe(false);
  expect(u2.classList.contains("msg-flash")).toBe(false);
});

test("the msg-flash class is removed again after the timeout elapses", async () => {
  const api = await import("../src/api");
  (api.getSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "ready", summary: "a summary", moments: [{ uuid: "u-anchor", label: "the moment" }],
    stale: false,
  });
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s9", agent: "claude", project_id: "p1", cwd: "/proj",
      worktree_label: "main", branch: null, cwd_exists: 1, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: null, title: null,
    },
    messages: [
      { id: 1, uuid: "u-anchor", role: "user",
        content: '{"type":"user","message":{"role":"user","content":"anchor me"}}',
        timestamp: 1, model: null, input_tokens: null, cache_create_tokens: null,
        cache_read_tokens: null, output_tokens: null, stop_reason: null },
    ],
    toolCalls: [], events: [],
  });

  const { container, getByText } = render(() => (
    <SessionTranscript sessionId="s9" onResume={() => {}} />
  ));
  // Let the initial async render (resource load, summary poll) settle on real timers
  // before switching to fake ones — waitFor itself polls via setTimeout.
  await waitFor(() => expect(container.textContent).toContain("the moment"));

  const target = container.querySelector('[data-msg-uuid="u-anchor"]') as HTMLElement;
  target.scrollIntoView = (() => {}) as never;

  vi.useFakeTimers();
  try {
    fireEvent.click(getByText("the moment"));
    expect(target.classList.contains("msg-flash")).toBe(true);

    vi.advanceTimersByTime(1200);
    expect(target.classList.contains("msg-flash")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("Resume button shows 'Resume (worktree gone)' when cwd_exists=0", async () => {
  const api = await import("../src/api");
  (api.getAgentSessionDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    session: {
      session_id: "s2", agent: "claude", project_id: "p1", cwd: "/gone",
      worktree_label: "gone", branch: null, cwd_exists: 0, parent_session_id: null,
      started_at: 0, last_activity: 1, message_count: 1, first_user_msg: "x",
    },
    messages: [], toolCalls: [], events: [],
  });
  const { container } = render(() => (
    <SessionTranscript sessionId="s2" onResume={() => {}} />
  ));
  await waitFor(() => container.textContent?.includes("worktree gone"));
});
