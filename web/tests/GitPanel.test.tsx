import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import GitPanel from "../src/components/GitPanel";

const fixtureCommits = [
  {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    subject: "third commit",
    author: "Alice <a@example.com>",
    timestamp: Date.now() - 60_000,
  },
  {
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    subject: "second commit",
    author: "Alice <a@example.com>",
    timestamp: Date.now() - 600_000,
  },
];

// A branches fetcher with a single `main` branch, so GitPanel auto-selects it.
const mainOnlyBranches = async () => ({
  base: "main",
  branches: [
    {
      name: "main",
      isCurrent: true,
      ahead: 0,
      behind: 0,
      hasWorktree: true,
      worktreePath: "/repo",
      dirty: false,
      lastCommit: Date.now(),
    },
  ],
});

describe("GitPanel", () => {
  test("renders commit subjects for the auto-selected branch", async () => {
    const fetcher = vi.fn(async () => ({ commits: fixtureCommits, hasMore: false }));
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => true}
        fetcher={fetcher}
        branchesFetcher={mainOnlyBranches}
        onOpenCommit={() => {}}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("third commit")).toBeTruthy();
    expect(screen.getByText("second commit")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith({ ref: "main" });
  });

  test("clicking a commit invokes onOpenCommit with the sha", async () => {
    const onOpenCommit = vi.fn();
    const fetcher = vi.fn(async () => ({ commits: fixtureCommits, hasMore: false }));
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => true}
        fetcher={fetcher}
        branchesFetcher={mainOnlyBranches}
        onOpenCommit={onOpenCommit}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByText("third commit"));
    expect(onOpenCommit).toHaveBeenCalledWith(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("Refresh button re-invokes the commit fetcher", async () => {
    const fetcher = vi.fn(async () => ({ commits: fixtureCommits, hasMore: false }));
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => true}
        fetcher={fetcher}
        branchesFetcher={mainOnlyBranches}
        onOpenCommit={() => {}}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("refresh"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("Load more passes before=<oldest sha> + ref and appends results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ commits: fixtureCommits, hasMore: true })
      .mockResolvedValueOnce({
        commits: [
          {
            sha: "cccccccccccccccccccccccccccccccccccccccc",
            subject: "first commit",
            author: "Alice <a@example.com>",
            timestamp: Date.now() - 1_200_000,
          },
        ],
        hasMore: false,
      });
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => true}
        fetcher={fetcher}
        branchesFetcher={mainOnlyBranches}
        onOpenCommit={() => {}}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByText(/load more/i));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith({
      before: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ref: "main",
    });
    expect(screen.getByText("first commit")).toBeTruthy();
  });

  test("does not fetch when disabled", async () => {
    const fetcher = vi.fn();
    const branchesFetcher = vi.fn();
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => false}
        fetcher={fetcher}
        branchesFetcher={branchesFetcher}
        onOpenCommit={() => {}}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).not.toHaveBeenCalled();
    expect(branchesFetcher).not.toHaveBeenCalled();
  });

  test("selecting a branch refetches commits with that ref", async () => {
    const branchesFetcher = async () => ({
      base: "main",
      branches: [
        {
          name: "main",
          isCurrent: true,
          ahead: 0,
          behind: 0,
          hasWorktree: true,
          worktreePath: "/repo",
          dirty: false,
          lastCommit: Date.now(),
        },
        {
          name: "feature",
          isCurrent: false,
          ahead: 2,
          behind: 0,
          hasWorktree: false,
          worktreePath: null,
          dirty: null,
          lastCommit: Date.now() - 1000,
        },
      ],
    });
    const fetcher = vi.fn(async (args: { before?: string; ref?: string }) => ({
      commits:
        args.ref === "feature"
          ? [{ sha: "f".repeat(40), subject: "feature commit", author: "A <a@x>", timestamp: Date.now() }]
          : fixtureCommits,
      hasMore: false,
    }));
    render(() => (
      <GitPanel
        projectId="p1"
        enabled={() => true}
        fetcher={fetcher}
        branchesFetcher={branchesFetcher}
        onOpenCommit={() => {}}
      />
    ));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByText("feature"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).toHaveBeenLastCalledWith({ ref: "feature" });
    expect(screen.getByText("feature commit")).toBeTruthy();
  });
});
