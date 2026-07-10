import { render } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";

vi.mock("../src/api", () => ({
  fileRawUrl: (p: string, path: string) =>
    `/raw/${p}/${encodeURIComponent(path)}`,
  fileBlobUrl: (p: string, path: string, ref: string) =>
    `/blob/${p}/${encodeURIComponent(path)}/${ref}`,
}));

import ImageDiffView from "../src/components/ImageDiffView";

function srcs(container: HTMLElement) {
  return [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
}

describe("ImageDiffView", () => {
  test("modified: before (blob) + after (raw)", () => {
    const { container } = render(() => (
      <ImageDiffView projectId="p1" path="a/logo.png" status="M" mtimeMs={7} />
    ));
    expect(srcs(container)).toEqual([
      "/blob/p1/a%2Flogo.png/HEAD",
      "/raw/p1/a%2Flogo.png",
    ]);
  });

  test("added: after only", () => {
    const { container } = render(() => (
      <ImageDiffView projectId="p1" path="a/logo.png" status="A" mtimeMs={7} />
    ));
    expect(srcs(container)).toEqual(["/raw/p1/a%2Flogo.png"]);
  });

  test("untracked: after only", () => {
    const { container } = render(() => (
      <ImageDiffView projectId="p1" path="a/logo.png" status="?" mtimeMs={7} />
    ));
    expect(srcs(container)).toEqual(["/raw/p1/a%2Flogo.png"]);
  });

  test("deleted: before only", () => {
    const { container } = render(() => (
      <ImageDiffView projectId="p1" path="a/logo.png" status="D" mtimeMs={null} />
    ));
    expect(srcs(container)).toEqual(["/blob/p1/a%2Flogo.png/HEAD"]);
  });
});
