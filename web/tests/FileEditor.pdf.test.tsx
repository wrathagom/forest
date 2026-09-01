import { test, expect, vi } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";

// vi.hoisted so these refs exist when the vi.mock factories run during import.
const { fetchFile, fileRawUrl, fetchGitDiff } = vi.hoisted(() => ({
  fetchFile: vi.fn(),
  fileRawUrl: vi.fn(),
  fetchGitDiff: vi.fn(),
}));

vi.mock("../src/api", () => ({ fetchFile, fileRawUrl, fetchGitDiff }));

// Stub PdfViewer so the test never boots pdf.js / a Web Worker in jsdom.
vi.mock("../src/components/PdfViewer", () => ({
  default: (props: { src: string }) => <div data-testid="pdf-viewer" data-src={props.src} />,
}));

import FileEditor from "../src/components/FileEditor";

test("renders PdfViewer for a pdf file", async () => {
  fetchFile.mockResolvedValue({ kind: "pdf", path: "doc.pdf", size: 1234, mtimeMs: 42 });
  fileRawUrl.mockReturnValue("/raw/doc.pdf?v=42");
  fetchGitDiff.mockResolvedValue({ status: null });

  const { getByTestId } = render(() => (
    <FileEditor projectId="p1" path="doc.pdf" onDirtyChange={() => {}} onViewDiff={() => {}} />
  ));

  await waitFor(() => {
    const el = getByTestId("pdf-viewer");
    expect(el.getAttribute("data-src")).toBe("/raw/doc.pdf?v=42");
  });
  expect(fileRawUrl).toHaveBeenCalledWith("p1", "doc.pdf", 42);
});
