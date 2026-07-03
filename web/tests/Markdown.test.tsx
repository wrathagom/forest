import { test, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import Markdown from "../src/components/Markdown";
import mermaid from "mermaid";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(),
    render: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(mermaid.parse).mockReset();
  vi.mocked(mermaid.render).mockReset();
});

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

test("a mermaid fence emits a placeholder carrying the raw source", () => {
  // parse never resolves, so the placeholder stays put for inspection
  vi.mocked(mermaid.parse).mockReturnValue(new Promise(() => {}) as never);
  const src = "graph TD\n  A --> B";
  const { container } = render(() => <Markdown text={"```mermaid\n" + src + "\n```"} />);
  const pending = container.querySelector<HTMLElement>("pre.mermaid-pending");
  expect(pending).toBeTruthy();
  expect(decodeURIComponent(pending!.dataset.src || "")).toBe(src);
});

test("a valid mermaid fence renders the diagram SVG", async () => {
  vi.mocked(mermaid.parse).mockResolvedValue(true as never);
  vi.mocked(mermaid.render).mockResolvedValue({
    svg: '<svg data-testid="diagram"></svg>',
  } as never);
  const { container } = render(() => <Markdown text={"```mermaid\ngraph TD\n  A --> B\n```"} />);
  await waitFor(() => {
    const rendered = container.querySelector("pre.mermaid-rendered");
    expect(rendered).toBeTruthy();
    expect(rendered!.querySelector('svg[data-testid="diagram"]')).toBeTruthy();
  });
});

test("an invalid mermaid fence falls back to a plain code block", async () => {
  vi.mocked(mermaid.parse).mockResolvedValue(false as never);
  const src = "not a real diagram {{{";
  const { container } = render(() => <Markdown text={"```mermaid\n" + src + "\n```"} />);
  await waitFor(() => {
    expect(container.querySelector("pre.mermaid-pending")).toBeNull();
    const code = container.querySelector("pre code");
    expect(code?.textContent).toContain(src);
  });
});
