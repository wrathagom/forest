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

const bucket = (input = 0, output = 0, cache = 0) => ({ input, output, cache });

const statsResponse = {
  tokensOverTime: Array.from({ length: 30 }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, input: i, output: i, cache: i, byProfile: { work: bucket(i, i, i) } })),
  tokensByProject: [{ projectId: "p1", projectName: "Proj One", input: 100, output: 20, cache: 5, sessions: 1, byProfile: { work: bucket(100, 20, 5) } }],
  tokensByProfile: [{ profile: "work", input: 100, output: 20, cache: 5, sessions: 1 }],
  profiles: ["work"],
  totals: { sessions: 1, input: 100, output: 20, cache: 5 },
};

// Two accounts on a single day, so a hidden account is a countable difference
// in the stacked time chart (2 segments → 1).
const twoProfileStats = {
  tokensOverTime: [{ day: "2026-04-01", input: 150, output: 0, cache: 0, byProfile: { work: bucket(100), personal: bucket(50) } }],
  tokensByProject: [{ projectId: "p1", projectName: "Proj One", input: 150, output: 0, cache: 0, sessions: 2, byProfile: { work: bucket(100), personal: bucket(50) } }],
  tokensByProfile: [
    { profile: "work", input: 100, output: 0, cache: 0, sessions: 1 },
    { profile: "personal", input: 50, output: 0, cache: 0, sessions: 1 },
  ],
  profiles: ["work", "personal"],
  totals: { sessions: 2, input: 150, output: 0, cache: 0 },
};

// Both accounts carry input *and* cache, so the two filters can be shown to
// compose rather than one masking the other.
const mixedTokenStats = {
  tokensOverTime: [{ day: "2026-04-01", input: 90, output: 0, cache: 60, byProfile: { work: bucket(60, 0, 40), personal: bucket(30, 0, 20) } }],
  tokensByProject: [{ projectId: "p1", projectName: "Proj One", input: 90, output: 0, cache: 60, sessions: 2, byProfile: { work: bucket(60, 0, 40), personal: bucket(30, 0, 20) } }],
  tokensByProfile: [
    { profile: "work", input: 60, output: 0, cache: 40, sessions: 1 },
    { profile: "personal", input: 30, output: 0, cache: 20, sessions: 1 },
  ],
  profiles: ["work", "personal"],
  totals: { sessions: 2, input: 90, output: 0, cache: 60 },
};

const legendItem = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll(".chart-legend-item")).find((el) =>
    el.textContent?.includes(label),
  ) as HTMLElement;

// The two bar charts share a class; the accounts one is the second card.
const accountChart = (container: HTMLElement) =>
  container.querySelectorAll(".sessions-charts .sessions-chart-card")[1] as HTMLElement;

async function showAccountCharts(container: HTMLElement, getByText: (t: string) => HTMLElement) {
  await waitFor(() => expect(getByText("by account")).toBeTruthy());
  fireEvent.click(getByText("by account"));
  await waitFor(() => expect(legendItem(container, "personal")).toBeTruthy());
}

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

test("both legends stay on screen in either chart mode, so no filter is invisible", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { getByText, container } = renderPage();
  await waitFor(() => expect(getByText("by account")).toBeTruthy());

  const legends = () => container.querySelector(".chart-toolbar")!.textContent!;
  expect(legends()).toContain("cache");
  expect(legends()).toContain("work");

  fireEvent.click(getByText("by account"));
  await waitFor(() => expect(legends()).toContain("work"));
  expect(legends()).toContain("cache");
});

test("clicking an account legend item toggles the off class", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(twoProfileStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  const item = legendItem(container, "personal");
  expect(item.classList.contains("off")).toBe(false);
  fireEvent.click(item);
  expect(legendItem(container, "personal").classList.contains("off")).toBe(true);
});

test("hiding an account drops its series from the tokens-over-time chart", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(twoProfileStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  expect(container.querySelectorAll("g.totc-bar rect")).toHaveLength(2);
  fireEvent.click(legendItem(container, "personal"));
  await waitFor(() => expect(container.querySelectorAll("g.totc-bar rect")).toHaveLength(1));
});

test("hiding an account drops its row from the tokens-by-account chart", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(twoProfileStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  expect(accountChart(container).querySelectorAll(".tbp-row")).toHaveLength(2);
  fireEvent.click(legendItem(container, "personal"));
  await waitFor(() => expect(accountChart(container).querySelectorAll(".tbp-row")).toHaveLength(1));
  expect(accountChart(container).textContent).toContain("work");
});

test("a hidden account stays hidden after switching back to 'by type'", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(twoProfileStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  fireEvent.click(legendItem(container, "personal"));
  await waitFor(() => expect(accountChart(container).querySelectorAll(".tbp-row")).toHaveLength(1));
  fireEvent.click(getByText("by type"));
  // the filter persists *and* its toggle is still on screen to undo it
  await waitFor(() => expect(legendItem(container, "personal").classList.contains("off")).toBe(true));
  expect(accountChart(container).querySelectorAll(".tbp-row")).toHaveLength(1);
});

test("the token-type filter still applies, and is still visible, in account mode", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(twoProfileStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  const axisMax = () => container.querySelector("text.chart-tick")!.textContent;
  expect(axisMax()).toBe("150"); // work 100 + personal 50, all input
  fireEvent.click(legendItem(container, "input"));
  await waitFor(() => expect(axisMax()).toBe("1")); // nothing left to stack
  expect(legendItem(container, "input").classList.contains("off")).toBe(true);
});

test("the account and token-type filters stack", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  fetchSessionsStats.mockResolvedValue(mixedTokenStats);
  const { getByText, container } = renderPage();
  await showAccountCharts(container, getByText);

  const axisMax = () => container.querySelector("text.chart-tick")!.textContent;
  expect(axisMax()).toBe("150"); // work 60+40, personal 30+20
  fireEvent.click(legendItem(container, "cache"));
  await waitFor(() => expect(axisMax()).toBe("90")); // input only: 60 + 30
  fireEvent.click(legendItem(container, "personal"));
  await waitFor(() => expect(axisMax()).toBe("60")); // work's input alone
});

test("selecting an account with no matches shows the filter empty-state, not the global one", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [], total: 0 });
  const { container } = renderPage();
  await waitFor(() => expect(container.querySelector(".sessions-profile")).toBeTruthy());
  fireEvent.change(container.querySelector(".sessions-profile") as HTMLSelectElement, { target: { value: "work" } });
  await waitFor(() => expect(container.textContent).toContain("no sessions match this filter"));
  expect(container.textContent).not.toContain("no agent sessions recorded yet");
});
