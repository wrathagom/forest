import { test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import MessageBlocks from "../src/components/MessageBlocks";

test("renders text blocks as text", () => {
  const { container } = render(() => <MessageBlocks blocks={[{ kind: "text", text: "hello world" }]} />);
  expect(container.textContent).toContain("hello world");
});

test("renders a tool_use block as a pill with the tool name and its summary", () => {
  const { container } = render(() => (
    <MessageBlocks blocks={[{ kind: "tool_use", name: "Bash", summary: "git status" }]} />
  ));
  const pill = container.querySelector(".tool-pill");
  expect(pill?.textContent).toContain("Bash");
  expect(container.textContent).toContain("git status");
});

test("a tool_use with no summary still renders the name pill", () => {
  const { container } = render(() => (
    <MessageBlocks blocks={[{ kind: "tool_use", name: "TodoWrite", summary: null }]} />
  ));
  expect(container.querySelector(".tool-pill")?.textContent).toContain("TodoWrite");
});

test("renders a successful tool_result as a muted result pill", () => {
  const { container } = render(() => (
    <MessageBlocks blocks={[{ kind: "tool_result", isError: false, preview: "file1" }]} />
  ));
  const pill = container.querySelector(".tool-result-pill");
  expect(pill).toBeTruthy();
  expect(pill?.classList.contains("is-error")).toBe(false);
});

test("renders an error tool_result with an error class", () => {
  const { container } = render(() => (
    <MessageBlocks blocks={[{ kind: "tool_result", isError: true, preview: "boom" }]} />
  ));
  expect(container.querySelector(".tool-result-pill.is-error")).toBeTruthy();
  expect(container.textContent).toContain("boom");
});

test("renders nothing for an empty block list", () => {
  const { container } = render(() => <MessageBlocks blocks={[]} />);
  expect(container.querySelector(".tool-pill")).toBeNull();
  expect(container.textContent?.trim()).toBe("");
});
