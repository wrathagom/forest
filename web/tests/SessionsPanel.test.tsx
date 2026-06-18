import { test, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import SessionsPanel from "../src/components/SessionsPanel";

vi.mock("../src/api", () => ({
  listAgentSessions: vi.fn(async () => ({
    sessions: [
      {
        session_id: "s1",
        agent: "claude",
        project_id: "p1",
        cwd: "/proj",
        worktree_label: "main",
        branch: null,
        cwd_exists: 1,
        parent_session_id: null,
        started_at: null,
        last_activity: Date.now() - 60_000,
        message_count: 12,
        first_user_msg: "build the thing",
      },
    ],
  })),
}));

test("renders rows from listAgentSessions and surfaces preview", async () => {
  const onOpen = vi.fn();
  const { container } = render(() => (
    <SessionsPanel projectId="p1" enabled={() => true} onOpenSession={onOpen} />
  ));
  await waitFor(() => expect(container.textContent).toContain("build the thing"));
  expect(container.textContent).toContain("main");
});

test("clicking a row calls onOpenSession with session_id", async () => {
  const onOpen = vi.fn();
  const { container } = render(() => (
    <SessionsPanel projectId="p1" enabled={() => true} onOpenSession={onOpen} />
  ));
  await waitFor(() => expect(container.querySelector(".sessions-row")).toBeTruthy());
  fireEvent.click(container.querySelector(".sessions-row")!);
  expect(onOpen).toHaveBeenCalledWith("s1", "build the thing");
});
