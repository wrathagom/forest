import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";

vi.mock("../src/api", () => ({
  fetchGitDiff: vi.fn(async () => ({
    path: "a/logo.png",
    diff: "Binary files a/logo.png and b/logo.png differ",
    status: "M",
    image: "image/png",
    mtimeMs: 5,
  })),
  fileRawUrl: (p: string, path: string) => `/raw/${p}/${encodeURIComponent(path)}`,
  fileBlobUrl: (p: string, path: string, ref: string) =>
    `/blob/${p}/${encodeURIComponent(path)}/${ref}`,
}));

import DiffView from "../src/components/DiffView";

describe("DiffView image branch", () => {
  test("renders image previews (not the text diff) for an image", async () => {
    const { container } = render(() => (
      <DiffView projectId="p1" path="a/logo.png" onOpenFile={() => {}} />
    ));
    await waitFor(() => {
      if (container.querySelectorAll("img").length !== 2) throw new Error("not yet");
    });
    expect(container.querySelector(".diff-pre")).toBeNull();
    expect(container.querySelector(".image-diff")).not.toBeNull();
  });
});
