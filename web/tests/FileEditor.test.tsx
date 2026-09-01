import { render, waitFor, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { GitFileStatus } from "../src/api";

let gitStatus: GitFileStatus | null = null;

vi.mock("../src/api", () => ({
  fetchFile: vi.fn(async () => ({
    kind: "image",
    path: "assets/logo.png",
    size: 1234,
    mtimeMs: 42,
    mime: "image/png",
  })),
  writeFile: vi.fn(async () => ({ path: "assets/logo.png", mtimeMs: 42, sha: "x" })),
  fileRawUrl: (projectId: string, path: string, version: number) =>
    `/api/projects/${encodeURIComponent(projectId)}/file/raw?path=${encodeURIComponent(path)}&v=${version}`,
  fetchGitDiff: vi.fn(async () => ({
    path: "assets/logo.png",
    diff: "",
    status: gitStatus,
    image: null,
    mtimeMs: 42,
  })),
}));

import FileEditor from "../src/components/FileEditor";

beforeEach(() => {
  gitStatus = null;
});

describe("FileEditor image rendering", () => {
  test("renders an <img> with the raw URL for image files", async () => {
    const { container } = render(() => (
      <FileEditor
        projectId="p1"
        path="assets/logo.png"
        onDirtyChange={() => {}}
        onViewDiff={() => {}}
      />
    ));
    const img = await waitFor(() => {
      const el = container.querySelector("img");
      if (!el) throw new Error("no img yet");
      return el as HTMLImageElement;
    });
    expect(img.getAttribute("src")).toBe(
      "/api/projects/p1/file/raw?path=assets%2Flogo.png&v=42",
    );
  });
});

describe("FileEditor view-diff button", () => {
  test("shows no view-diff button for a clean file", async () => {
    gitStatus = null;
    const { container } = render(() => (
      <FileEditor
        projectId="p1"
        path="assets/logo.png"
        onDirtyChange={() => {}}
        onViewDiff={() => {}}
      />
    ));
    // Wait for the image (proves the git-status resource has had a chance to run).
    await waitFor(() => {
      if (!container.querySelector("img")) throw new Error("no img yet");
    });
    expect(container.querySelector(".file-editor-bar")).toBeNull();
  });

  test("shows a view-diff button for a changed file and calls onViewDiff", async () => {
    gitStatus = "M";
    const onViewDiff = vi.fn();
    const { getByText } = render(() => (
      <FileEditor
        projectId="p1"
        path="assets/logo.png"
        onDirtyChange={() => {}}
        onViewDiff={onViewDiff}
      />
    ));
    const btn = await waitFor(() => getByText("view diff"));
    fireEvent.click(btn);
    expect(onViewDiff).toHaveBeenCalledWith("assets/logo.png");
  });

  test("shows no view-diff button for a gitignored file", async () => {
    gitStatus = "!";
    const { container } = render(() => (
      <FileEditor
        projectId="p1"
        path="assets/logo.png"
        onDirtyChange={() => {}}
        onViewDiff={() => {}}
      />
    ));
    await waitFor(() => {
      if (!container.querySelector("img")) throw new Error("no img yet");
    });
    expect(container.querySelector(".file-editor-bar")).toBeNull();
  });
});
