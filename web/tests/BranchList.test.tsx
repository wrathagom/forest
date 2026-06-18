import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import BranchList from "../src/components/BranchList";
import type { GitBranch } from "../src/api";

function branch(over: Partial<GitBranch> & { name: string }): GitBranch {
  return {
    isCurrent: false,
    ahead: 0,
    behind: 0,
    hasWorktree: false,
    worktreePath: null,
    dirty: null,
    lastCommit: Date.now(),
    ...over,
  };
}

const fixture = {
  base: "main",
  branches: [
    branch({ name: "main", isCurrent: true, hasWorktree: true, worktreePath: "/repo", dirty: false }),
    branch({ name: "feature", ahead: 3, behind: 1, hasWorktree: true, worktreePath: "/repo/.worktrees/feature", dirty: true }),
  ],
};

describe("BranchList", () => {
  test("renders branch names and ahead/behind badges", async () => {
    const [selected] = createSignal<string | null>("main");
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => true}
        selected={selected}
        onSelect={() => {}}
        fetcher={async () => fixture}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("feature")).toBeTruthy();
    expect(screen.getByText("↑3")).toBeTruthy();
    expect(screen.getByText("↓1")).toBeTruthy();
  });

  test("auto-selects the base branch on first load", async () => {
    const [selected, setSelected] = createSignal<string | null>(null);
    const onSelect = vi.fn((b: string) => setSelected(b));
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => true}
        selected={selected}
        onSelect={onSelect}
        fetcher={async () => fixture}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(onSelect).toHaveBeenCalledWith("main");
  });

  test("falls back to base when selected branch disappears from list", async () => {
    const [selected, setSelected] = createSignal<string | null>("feature");
    const onSelect = vi.fn((b: string) => setSelected(b));
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => true}
        selected={selected}
        onSelect={onSelect}
        fetcher={async () => ({
          base: "main",
          branches: [branch({ name: "main", isCurrent: true })],
        })}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(onSelect).toHaveBeenCalledWith("main");
  });

  test("clicking a branch calls onSelect with its name", async () => {
    const [selected] = createSignal<string | null>("main");
    const onSelect = vi.fn();
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => true}
        selected={selected}
        onSelect={onSelect}
        fetcher={async () => fixture}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    fireEvent.click(screen.getByText("feature"));
    expect(onSelect).toHaveBeenCalledWith("feature");
  });

  test("does not fetch when disabled", async () => {
    const [selected] = createSignal<string | null>(null);
    const fetcher = vi.fn();
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => false}
        selected={selected}
        onSelect={() => {}}
        fetcher={fetcher}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("refreshToken triggers a re-fetch", async () => {
    const [selected] = createSignal<string | null>("main");
    const [refreshToken, setRefreshToken] = createSignal(0);
    const fetcher = vi.fn(async () => fixture);
    render(() => (
      <BranchList
        projectId="p1"
        enabled={() => true}
        selected={selected}
        onSelect={() => {}}
        fetcher={fetcher}
        refreshToken={refreshToken}
      />
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).toHaveBeenCalledTimes(1);
    setRefreshToken((t) => t + 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
