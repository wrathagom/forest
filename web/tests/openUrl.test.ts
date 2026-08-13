import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openUrl } from "../src/lib/openUrl";

/**
 * Captures the synthesized anchor click instead of letting jsdom attempt a
 * navigation, and records what would have been opened.
 */
let opened: { href: string; target: string; rel: string }[] = [];
const capture = (e: Event) => {
  const a = (e.target as HTMLElement).closest("a");
  if (a) opened.push({ href: a.href, target: a.target, rel: a.rel });
  e.preventDefault();
};

beforeEach(() => {
  opened = [];
  document.addEventListener("click", capture, true);
});

afterEach(() => {
  document.removeEventListener("click", capture, true);
  vi.restoreAllMocks();
});

describe("openUrl", () => {
  test("opens http(s) URLs in a new tab", () => {
    expect(openUrl("https://example.com/foo")).toBe(true);
    expect(opened).toEqual([
      { href: "https://example.com/foo", target: "_blank", rel: "noopener noreferrer" },
    ]);
  });

  test("never routes through window.open, which popup blockers kill", () => {
    // The regression: xterm's built-in handlers call window.open(), so once the
    // browser blocks popups for the Forest origin every terminal link goes dead
    // — hover still works, the click silently does nothing, and no reload helps.
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    openUrl("https://example.com/foo");
    expect(spy).not.toHaveBeenCalled();
    expect(opened).toHaveLength(1);
  });

  test("leaves no anchor behind in the document", () => {
    openUrl("https://example.com/foo");
    expect(document.querySelectorAll("a").length).toBe(0);
  });

  test.each(["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x"])(
    "refuses %s — terminal output is untrusted, and OSC 8 lets it pick any scheme",
    (uri) => {
      expect(openUrl(uri)).toBe(false);
      expect(opened).toEqual([]);
    },
  );

  test("refuses garbage that does not parse as a URL", () => {
    expect(openUrl("not a url")).toBe(false);
    expect(opened).toEqual([]);
  });
});
