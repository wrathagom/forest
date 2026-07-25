import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import ThemeSheet from "../src/pages/mobile/ThemeSheet";
import { THEMES } from "../src/lib/themes/index";
import { setTheme } from "../src/lib/themes/current";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("mobile ThemeSheet", () => {
  test("the sheet is closed until the swatch button is tapped", () => {
    render(() => <ThemeSheet />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("lists every theme", () => {
    render(() => <ThemeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    for (const theme of THEMES) {
      expect(screen.getByRole("button", { name: new RegExp(`^${theme.name}$`, "i") })).toBeTruthy();
    }
  });

  test("tapping a theme applies it and closes the sheet", () => {
    render(() => <ThemeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    fireEvent.click(screen.getByRole("button", { name: /^mocha$/i }));
    expect(localStorage.getItem("forest.theme")).toBe(JSON.stringify("catppuccin-mocha"));
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1e1e2e");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("tapping the backdrop closes without changing the theme", () => {
    render(() => <ThemeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    fireEvent.click(screen.getByTestId("theme-sheet-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("forest.theme")).toBeNull();
  });

  test("Escape closes without changing the theme", () => {
    render(() => <ThemeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("forest.theme")).toBeNull();
  });

  test("the Escape listener does not outlive the sheet", () => {
    render(() => <ThemeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    // A second Escape with the sheet closed must not reopen it or throw.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
  });

  // jsdom has no scrollIntoView, so stub the prototype: the sheet calls it
  // through `?.` and would silently do nothing either way.
  test("scrolls the active theme into view when opened", () => {
    setTheme("solarized-light");
    const proto = Element.prototype as unknown as Record<string, unknown>;
    const had = "scrollIntoView" in proto;
    const original = proto.scrollIntoView;
    const scrolled: string[] = [];
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("aria-label") ?? "");
    };
    try {
      render(() => <ThemeSheet />);
      fireEvent.click(screen.getByRole("button", { name: /theme/i }));
      expect(scrolled).toEqual(["Solarized Light"]);
    } finally {
      if (had) proto.scrollIntoView = original;
      else delete proto.scrollIntoView;
    }
  });
});
