import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import ThemeSheet from "../src/pages/mobile/ThemeSheet";
import { THEMES } from "../src/lib/themes/index";

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
});
