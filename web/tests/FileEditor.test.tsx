import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";

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
}));

import FileEditor from "../src/components/FileEditor";

describe("FileEditor image rendering", () => {
  test("renders an <img> with the raw URL for image files", async () => {
    const { container } = render(() => (
      <FileEditor projectId="p1" path="assets/logo.png" onDirtyChange={() => {}} />
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
