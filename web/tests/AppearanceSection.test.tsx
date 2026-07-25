import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import AppearanceSection from "../src/components/settings/AppearanceSection";
import DashboardSection from "../src/components/settings/DashboardSection";
import { THEMES, DEFAULT_THEME_ID } from "../src/lib/themes/index";
import { setTheme } from "../src/lib/themes/current";

// themeId is a module-level persistedSignal: it reads localStorage once, at
// import. Writing "forest.theme" from a test therefore does nothing to the
// live signal, and the theme one test picks would otherwise leak into the
// next. Reset through the public API instead, then clear the write it made.
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  setTheme(DEFAULT_THEME_ID);
  localStorage.clear();
});

// The family label lives in .theme-family-name. Querying by text alone is not
// enough: four families (Rosé Pine, Dracula, Nord, Tokyo Night) are named
// exactly like their only theme, so getByText(family) also matches the card.
function familyHeadings(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".theme-family-name")].map((el) =>
    (el.textContent ?? "").trim(),
  );
}

function activeCardLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".theme-card.active")].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("AppearanceSection", () => {
  test("renders a card for every theme", () => {
    render(() => <AppearanceSection />);
    for (const theme of THEMES) {
      expect(screen.getByRole("button", { name: new RegExp(theme.name, "i") })).toBeTruthy();
    }
  });

  test("groups cards by family", () => {
    const { container } = render(() => <AppearanceSection />);
    const headings = familyHeadings(container);
    for (const family of new Set(THEMES.map((t) => t.family))) {
      expect(
        headings.some((h) => h === family || h === `${family} (light)`),
        `expected a group heading for ${family}, got: ${headings.join(" | ")}`,
      ).toBe(true);
    }
  });

  // Why the groups are split by scheme at all: a light theme must not ambush
  // someone scanning the dark ones.
  test("lists every dark family before any light one", () => {
    const { container } = render(() => <AppearanceSection />);
    const isLight = familyHeadings(container).map((h) => h.endsWith("(light)"));
    const firstLight = isLight.indexOf(true);
    const lastDark = isLight.lastIndexOf(false);
    expect(firstLight).toBeGreaterThan(-1); // there is at least one light family
    expect(lastDark).toBeLessThan(firstLight);
  });

  test("clicking a theme applies and persists it immediately", () => {
    render(() => <AppearanceSection />);
    fireEvent.click(screen.getByRole("button", { name: /mocha/i }));
    expect(localStorage.getItem("forest.theme")).toBe(JSON.stringify("catppuccin-mocha"));
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1e1e2e");
  });

  test("has no save button", () => {
    render(() => <AppearanceSection />);
    expect(screen.queryByText("save")).toBeNull();
  });

  test("marks the active theme, and only that one", () => {
    setTheme("nord");
    const { container } = render(() => <AppearanceSection />);
    const card = screen.getByRole("button", { name: /nord/i });
    expect(card.className).toContain("active");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(activeCardLabels(container)).toEqual(["Nord"]);
  });
});

describe("DashboardSection", () => {
  test("toggling auto-refresh persists immediately", () => {
    render(() => <DashboardSection />);
    const box = screen.getByLabelText(/auto-refresh/i) as HTMLInputElement;
    const before = box.checked;
    fireEvent.click(box);
    expect(localStorage.getItem("forest.dashboard.autoRefresh")).toBe(JSON.stringify(!before));
  });
});
