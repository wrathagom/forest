import { test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";

// vi.hoisted so these refs exist when the vi.mock factory runs during import.
const { fetchSessionsOverview, fetchSessionsStats } = vi.hoisted(() => ({
  fetchSessionsOverview: vi.fn(),
  fetchSessionsStats: vi.fn(),
}));

vi.mock("../src/api", () => ({ fetchSessionsOverview, fetchSessionsStats }));

import Sessions from "../src/pages/Sessions";

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  session_id: "s1",
  agent: "claude",
  project_id: "p1",
  project_name: "Proj One",
  cwd: "/p1",
  worktree_label: "main",
  branch: null,
  profile: "work",
  cwd_exists: 1,
  parent_session_id: null,
  started_at: Date.now() - 3_600_000,
  last_activity: Date.now() - 60_000,
  message_count: 12,
  first_user_msg: "build the thing",
  input_tokens: 100,
  output_tokens: 20,
  cache_tokens: 5,
  ...over,
});

const statsResponse = {
  tokensOverTime: Array.from({ length: 30 }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, input: i, output: i, cache: i, byProfile: { work: i } })),
  tokensByProject: [{ projectId: "p1", projectName: "Proj One", input: 100, output: 20, cache: 5, sessions: 1 }],
  tokensByProfile: [{ profile: "work", input: 100, output: 20, cache: 5, sessions: 1 }],
  profiles: ["work"],
  totals: { sessions: 1, input: 100, output: 20, cache: 5 },
};

function renderPage() {
  return render(() => (
    <Router>
      <Route path="/" component={Sessions} />
    </Router>
  ));
}

beforeEach(() => {
  fetchSessionsOverview.mockReset();
  fetchSessionsStats.mockReset();
  fetchSessionsStats.mockResolvedValue(statsResponse);
});

test("renders the session list and the stats strip", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(container.textContent).toContain("build the thing"));
  expect(container.textContent).toContain("Proj One");
});

test("typing in the search box re-fetches with q", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(fetchSessionsOverview).toHaveBeenCalled());
  fireEvent.input(container.querySelector(".sessions-search")!, { target: { value: "thing" } });
  await waitFor(() =>
    expect(fetchSessionsOverview.mock.calls.some(([a]) => (a as { q?: string }).q === "thing")).toBe(true),
  );
});

test("clicking a sortable header re-fetches with that sort", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { getByText } = renderPage();
  await waitFor(() => expect(fetchSessionsOverview).toHaveBeenCalled());
  fireEvent.click(getByText("tokens"));
  await waitFor(() =>
    expect(fetchSessionsOverview.mock.calls.some(([a]) => (a as { sort?: string }).sort === "tokens")).toBe(true),
  );
});

test("load more fetches the next page and appends", async () => {
  fetchSessionsOverview.mockResolvedValueOnce({ sessions: [row({ session_id: "s1", first_user_msg: "first" })], total: 2 });
  fetchSessionsOverview.mockResolvedValueOnce({ sessions: [row({ session_id: "s2", first_user_msg: "second" })], total: 2 });
  const { container, getByText } = renderPage();
  await waitFor(() => expect(container.textContent).toContain("first"));
  fireEvent.click(getByText(/load more/i));
  await waitFor(() => expect(container.textContent).toContain("second"));
  expect(container.textContent).toContain("first");
});

test("shows an empty state when there are no sessions", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [], total: 0 });
  fetchSessionsStats.mockResolvedValue({ tokensOverTime: [], tokensByProject: [], totals: { sessions: 0, input: 0, output: 0, cache: 0 } });
  const { container } = renderPage();
  await waitFor(() => expect(container.textContent).toMatch(/no agent sessions/i));
});

test("clicking the cache legend button toggles the off class", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { getByText } = renderPage();
  await waitFor(() => expect(getByText("cache")).toBeTruthy());
  const btn = getByText("cache");
  expect(btn.classList.contains("off")).toBe(false);
  fireEvent.click(btn);
  expect(btn.classList.contains("off")).toBe(true);
});

test("renders the profile column with the session's account", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(container.textContent).toContain("build the thing"));
  const headers = Array.from(container.querySelectorAll(".sessions-table th")).map((h) => h.textContent);
  expect(headers.some((h) => h?.includes("profile"))).toBe(true);
});

test("selecting an account re-fetches with the profile filter", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(fetchSessionsOverview).toHaveBeenCalled());
  const select = container.querySelector(".sessions-profile") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "work" } });
  await waitFor(() =>
    expect(fetchSessionsOverview.mock.calls.some(([a]) => (a as { profile?: string }).profile === "work")).toBe(true),
  );
});

test("switching the chart to 'by account' shows the profile legend", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { getByText, container } = renderPage();
  await waitFor(() => expect(getByText("by account")).toBeTruthy());
  fireEvent.click(getByText("by account"));
  await waitFor(() => expect(container.querySelector(".chart-legend")?.textContent).toContain("work"));
  expect(container.textContent).not.toContain("input");
});

test("selecting an account with no matches shows the filter empty-state, not the global one", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [], total: 0 });
  const { container } = renderPage();
  await waitFor(() => expect(container.querySelector(".sessions-profile")).toBeTruthy());
  fireEvent.change(container.querySelector(".sessions-profile") as HTMLSelectElement, { target: { value: "work" } });
  await waitFor(() => expect(container.textContent).toContain("no sessions match this filter"));
  expect(container.textContent).not.toContain("no agent sessions recorded yet");
});
