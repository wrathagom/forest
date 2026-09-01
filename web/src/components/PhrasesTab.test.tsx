import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import PhrasesTab from "./PhrasesTab";
import * as api from "../api";

// PhrasesTab calls useNavigate() at the top level, which throws outside a
// <Router> context. The rest of this codebase's tests mock the router the
// same way (see tests/mobile-SessionList.test.tsx) rather than wrapping
// every render in a live Router.
vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn() }));

describe("PhrasesTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "fetchPhraseStatus").mockResolvedValue({ lastBuiltAt: 1_700_000_000_000, rowCount: 10, building: false, staleNewMsgs: 0 });
    vi.spyOn(api, "fetchPhrases").mockResolvedValue({
      total: 1,
      phrases: [{ phrase: "in a way that matters", n: 5, count: 47, monthly: [{ month: "2026-06", count: 47 }], trendScore: 47 }],
    });
  });

  test("renders leaderboard rows from the API", async () => {
    render(() => <PhrasesTab />);
    expect(await screen.findByText("in a way that matters")).toBeTruthy();
    expect(await screen.findByText("47")).toBeTruthy();
  });
});
