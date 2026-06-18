import { test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import Markdown from "../src/components/Markdown";

test("renders bold text as <strong>", () => {
  const { container } = render(() => <Markdown text="this is **bold** here" />);
  expect(container.querySelector("strong")?.textContent).toBe("bold");
});

test("renders a bullet list as <ul><li>", () => {
  const { container } = render(() => <Markdown text={"- one\n- two\n- three"} />);
  expect(container.querySelectorAll("ul li")).toHaveLength(3);
});

test("renders a fenced code block as <pre><code>", () => {
  const { container } = render(() => <Markdown text={"```\nconst x = 1;\n```"} />);
  const code = container.querySelector("pre code");
  expect(code?.textContent).toContain("const x = 1;");
});

test("renders inline code as <code>", () => {
  const { container } = render(() => <Markdown text="call `foo()` now" />);
  expect(container.querySelector("code")?.textContent).toBe("foo()");
});

test("renders a link as <a href>", () => {
  const { container } = render(() => <Markdown text="see [docs](https://example.com)" />);
  const a = container.querySelector("a");
  expect(a?.getAttribute("href")).toBe("https://example.com");
  expect(a?.textContent).toBe("docs");
});

test("renders headings", () => {
  const { container } = render(() => <Markdown text={"## Section"} />);
  expect(container.querySelector("h2")?.textContent).toBe("Section");
});

test("wraps output in a .markdown-body container", () => {
  const { container } = render(() => <Markdown text="plain" />);
  expect(container.querySelector(".markdown-body")).toBeTruthy();
});

test("plain text with no markdown still renders its text", () => {
  const { container } = render(() => <Markdown text="just a sentence." />);
  expect(container.textContent).toContain("just a sentence.");
});
