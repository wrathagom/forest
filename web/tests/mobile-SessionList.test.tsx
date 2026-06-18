import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import type { MobileSessionsResponse } from "../src/api";

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

const { fetchMobileSessions } = vi.hoisted(() => ({ fetchMobileSessions: vi.fn() }));
vi.mock("../src/api", () => ({ fetchMobileSessions }));

import SessionList from "../src/pages/mobile/SessionList";

const sample = (over: Partial<MobileSessionsResponse> = {}): MobileSessionsResponse => ({
  needsYou: [{ sessionId: "a", projectId: "p", projectName: "api", label: "add a migration", snippet: "Want me to run it on staging?", state: "waiting", lastActivity: Date.now() - 4 * 60_000, launchedVia: "mobile", forestActionable: true }],
  working: [{ sessionId: "b", projectId: "p2", projectName: "dotfiles", label: "refactor the install script", snippet: null, state: "working", lastActivity: Date.now() - 60_000, launchedVia: "mobile", forestActionable: true }],
  recent: [{ sessionId: "c", projectId: "p", projectName: "api", label: "fix the flaky auth test", snippet: null, state: "done", lastActivity: Date.now() - 3_600_000, launchedVia: null, forestActionable: true }],
  ...over,
});

beforeEach(() => { navigate.mockReset(); fetchMobileSessions.mockReset(); });

test("renders the three buckets with project names and section labels", async () => {
  fetchMobileSessions.mockResolvedValue(sample());
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(container.textContent).toContain("add a migration"));
  expect(container.textContent).toContain("refactor the install script");
  expect(container.textContent).toContain("fix the flaky auth test");
  // bucket section labels
  const text = container.textContent ?? "";
  expect(/your turn/i.test(text)).toBe(true);
  expect(/working/i.test(text)).toBe(true);
  expect(/recent/i.test(text)).toBe(true);
  // a waiting row carries the amber data-state
  expect(container.querySelector('.m-row[data-state="waiting"]')).toBeTruthy();
});

test("the waiting row shows its assistant snippet, not just the label", async () => {
  fetchMobileSessions.mockResolvedValue(sample());
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(container.textContent).toContain("Want me to run it on staging?"));
});

test("tapping a row navigates to /m/s/<sid>", async () => {
  fetchMobileSessions.mockResolvedValue(sample());
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(container.querySelector(".m-row")).toBeTruthy());
  fireEvent.click(container.querySelector(".m-row")!);
  expect(navigate).toHaveBeenCalledWith("/m/s/a");
});

test("the + new run button navigates to /m/new", async () => {
  fetchMobileSessions.mockResolvedValue(sample());
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(container.querySelector(".m-btn")).toBeTruthy());
  fireEvent.click([...container.querySelectorAll(".m-btn")].find((b) => /new run/i.test(b.textContent ?? ""))!);
  expect(navigate).toHaveBeenCalledWith("/m/new");
});

test("empty state when all buckets are empty", async () => {
  fetchMobileSessions.mockResolvedValue({ needsYou: [], working: [], recent: [] });
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(/no sessions yet/i.test(container.textContent ?? "")).toBe(true));
});

test("renders an error banner when the fetch fails", async () => {
  fetchMobileSessions.mockRejectedValue(new Error("boom"));
  const { container } = render(() => <SessionList />);
  await waitFor(() => expect(container.querySelector(".m-error")).toBeTruthy());
});
