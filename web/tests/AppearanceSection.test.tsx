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

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".theme-family-name")].map((el) =>
    (el.textContent ?? "").trim(),
  );
}

// The cards under a heading, in DOM order, by the theme name on the card.
function cardsUnder(container: HTMLElement, heading: string): string[] {
  const group = [...container.querySelectorAll(".theme-family")].find(
    (g) => g.querySelector(".theme-family-name")?.textContent?.trim() === heading,
  );
  if (!group) return [];
  return [...group.querySelectorAll(".theme-card")].map(
    (el) => el.getAttribute("aria-label") ?? "",
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

  // The family used to be a heading. It now lives on the card, so it has to be
  // visible there — otherwise regrouping by scheme would have thrown the
  // information away rather than moved it.
  test("shows the family on the card when it differs from the theme name", () => {
    const { container } = render(() => <AppearanceSection />);
    for (const theme of THEMES) {
      const card = screen.getByRole("button", { name: new RegExp(`^${theme.name}$`, "i") });
      const family = card.querySelector(".theme-card-family")?.textContent?.trim() ?? null;
      // Rosé Pine, Dracula, Nord and Tokyo Night are the only theme in a family
      // named after them: a card reading "Dracula / Dracula" says nothing twice.
      expect(family, `${theme.name} family line`).toBe(
        theme.family === theme.name ? null : theme.family,
      );
    }
    expect(container.querySelectorAll(".theme-card-family").length).toBe(
      THEMES.filter((t) => t.family !== t.name).length,
    );
  });

  // The reason for grouping at all: a light theme must not ambush someone
  // scanning the dark ones.
  test("groups into dark then light, and nothing else", () => {
    const { container } = render(() => <AppearanceSection />);
    expect(headings(container)).toEqual(["dark", "light"]);

    const byName = new Map(THEMES.map((t) => [t.name, t]));
    const schemeOf = (names: string[]) => [...new Set(names.map((n) => byName.get(n)?.scheme))];
    expect(schemeOf(cardsUnder(container, "dark"))).toEqual(["dark"]);
    expect(schemeOf(cardsUnder(container, "light"))).toEqual(["light"]);
    // every theme is placed, none twice
    expect(cardsUnder(container, "dark").length + cardsUnder(container, "light").length).toBe(
      THEMES.length,
    );
  });

  test("keeps registry order within a group, so families stay together", () => {
    const { container } = render(() => <AppearanceSection />);
    expect(cardsUnder(container, "dark")).toEqual(
      THEMES.filter((t) => t.scheme === "dark").map((t) => t.name),
    );
    expect(cardsUnder(container, "light")).toEqual(
      THEMES.filter((t) => t.scheme === "light").map((t) => t.name),
    );
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
