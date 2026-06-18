import { test, expect, vi } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import SessionTranscript from "../src/components/SessionTranscript";

vi.mock("../src/api", () => ({
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
