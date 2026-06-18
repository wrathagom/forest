import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("../src/api", () => ({
  fetchTreeChildren: vi.fn(),
}));

import FileTreePanel from "../src/components/FileTreePanel";
import { fetchTreeChildren } from "../src/api";
import type { TreeEntry } from "../src/api";

const mockChildren = vi.mocked(fetchTreeChildren);

beforeEach(() => {
  localStorage.clear();
  mockChildren.mockReset();
});

const sampleTree: TreeEntry[] = [
  { path: "src", type: "dir", size: null, gitStatus: null },
  { path: "src/ui", type: "dir", size: null, gitStatus: null },
  { path: "src/main.ts", type: "file", size: 100, gitStatus: null },
  { path: "src/ui/App.tsx", type: "file", size: 200, gitStatus: "M" },
  { path: "package.json", type: "file", size: 50, gitStatus: null },
  { path: "untracked.md", type: "file", size: 20, gitStatus: "?" },
];

describe("FileTreePanel", () => {
  test("renders top-level entries (dirs first, then files)", () => {
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    expect(screen.getByText(/src/)).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
  });

  test("expanded dirs show their children", () => {
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    expect(screen.getByText(/ui/)).toBeTruthy();
    expect(screen.getByText("main.ts")).toBeTruthy();
  });

  test("clicking a clean file calls onOpenFile, not onOpenDiff", () => {
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    fireEvent.click(screen.getByText("main.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("src/main.ts");
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  test("clicking a modified file calls onOpenDiff, not onOpenFile", () => {
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    fireEvent.click(screen.getByText(/^[▸▾]\s+ui$/));
    fireEvent.click(screen.getByText("App.tsx"));
    expect(onOpenDiff).toHaveBeenCalledWith("src/ui/App.tsx");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  test("renders the badge character for files with gitStatus", () => {
    const { container } = render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    fireEvent.click(screen.getByText(/^[▸▾]\s+ui$/));
    const badges = Array.from(
      container.querySelectorAll(".tree-badge"),
    ).map((n) => n.textContent);
    expect(badges).toContain("M");
    expect(badges).toContain("?");
  });

  test("ancestor directories of a changed file get the dirty class", () => {
    const { container } = render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    // src and src/ui are both ancestors of src/ui/App.tsx (M)
    const dirtyDirs = Array.from(
      container.querySelectorAll(".tree-dir.tree-dir-dirty"),
    ).map((n) => n.textContent?.trim());
    expect(dirtyDirs.some((t) => t?.endsWith("src"))).toBe(true);
  });

  test("active file path is highlighted", () => {
    const { container } = render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath="src/main.ts"
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    const active = container.querySelector(".tree-file-active");
    expect(active?.textContent).toContain("main.ts");
  });

  test("expanded state persists to localStorage", () => {
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={sampleTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+src$/));
    const stored = JSON.parse(localStorage.getItem("forest.fileTree.expanded.p1")!);
    expect(stored).toContain("src");
  });

  const ignoredTree: TreeEntry[] = [
    { path: ".worktrees", type: "dir", size: null, gitStatus: "!" },
    { path: "package.json", type: "file", size: 50, gitStatus: null },
  ];

  test("expanding an ignored dir fetches and shows its children", async () => {
    mockChildren.mockResolvedValue({
      entries: [
        { path: ".worktrees/feat", type: "dir", size: null, gitStatus: "!" },
        { path: ".worktrees/notes.md", type: "file", size: 10, gitStatus: "!" },
      ],
    });
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={ignoredTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+\.worktrees$/));
    expect(mockChildren).toHaveBeenCalledWith("p1", ".worktrees");
    expect(await screen.findByText("notes.md")).toBeTruthy();
    expect(await screen.findByText(/feat/)).toBeTruthy();
  });

  test("a failed lazy load shows a retry row that re-fetches", async () => {
    mockChildren.mockRejectedValueOnce(new Error("nope"));
    render(() => (
      <FileTreePanel
        projectId="p1"
        entries={ignoredTree}
        activeFilePath={null}
        onOpenFile={() => {}}
        onOpenDiff={() => {}}
      />
    ));
    fireEvent.click(screen.getByText(/^[▸▾]\s+\.worktrees$/));
    const retry = await screen.findByText(/retry/i);
    expect(retry).toBeTruthy();

    mockChildren.mockResolvedValueOnce({
      entries: [
        { path: ".worktrees/ok.md", type: "file", size: 1, gitStatus: "!" },
      ],
    });
    fireEvent.click(retry);
    expect(await screen.findByText("ok.md")).toBeTruthy();
  });
});
