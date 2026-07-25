import { describe, expect, test } from "vitest";
import { THEMES, THEME_BY_ID, DEFAULT_THEME_ID } from "../src/lib/themes/index";
import { TOKEN_KEYS } from "../src/lib/themes/types";
import { contrast } from "./helpers/contrast";

describe("registry", () => {
  test("theme ids are unique", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the default theme resolves", () => {
    expect(THEME_BY_ID[DEFAULT_THEME_ID]).toBeDefined();
  });

  test("every theme is reachable by id", () => {
    for (const t of THEMES) expect(THEME_BY_ID[t.id]).toBe(t);
  });
});

describe.each(THEMES.map((t) => [t.id, t] as const))("%s", (_id, theme) => {
  test("defines every token as a 6-digit hex", () => {
    for (const key of TOKEN_KEYS) {
      expect(theme.tokens[key], `${theme.id}.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("has 8 distinct chart colors", () => {
    const charts = [
      theme.tokens.chart1, theme.tokens.chart2, theme.tokens.chart3, theme.tokens.chart4,
      theme.tokens.chart5, theme.tokens.chart6, theme.tokens.chart7, theme.tokens.chart8,
    ];
    expect(new Set(charts).size, `${theme.id} chart colors repeat`).toBe(8);
  });

  // Hard floors — these pairs are decided by our mapping, so a failure is our bug.
  test("body text clears 4.5:1", () => {
    expect(contrast(theme.tokens.fg, theme.tokens.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test("secondary text clears 3:1", () => {
    expect(contrast(theme.tokens.fgDim, theme.tokens.bg)).toBeGreaterThanOrEqual(3);
  });

  // Lower than the fgDim floor on purpose — this tier is for deliberately
  // de-emphasized text (gutter numbers, the abandoned task badge, muted
  // chips). 2.5 catches a theme where it collapses into the background
  // without rejecting legitimate published values: Dracula's #6272a4 sits
  // at ~2.8:1.
  test("the faint tier stays distinguishable", () => {
    expect(contrast(theme.tokens.fgFaint, theme.tokens.bg)).toBeGreaterThanOrEqual(2.5);
  });

  test("text on an accent fill clears 4.5:1", () => {
    expect(contrast(theme.tokens.accentFg, theme.tokens.accent)).toBeGreaterThanOrEqual(4.5);
  });

  // Role hues come from each project's published palette. Catppuccin Latte's own
  // green is 2.96:1 and its yellow 2.31:1 against its base; enforcing 3:1 would
  // mean overriding the palette authors. A floor of 2.0 still catches the bug
  // that matters — a role pointed at the wrong palette entry, e.g. `ok`
  // accidentally mapped to a surface color.
  test.each(["accent", "ok", "warn", "error", "info"] as const)(
    "%s is distinguishable from the background",
    (role) => {
      const ratio = contrast(theme.tokens[role], theme.tokens.bg);
      expect(ratio, `${theme.id}.${role} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(2.0);
    },
  );
});

// Prints the full role-contrast table so a reviewer sees real numbers rather
// than a silent pass. Never fails.
test("role contrast report", () => {
  const rows = THEMES.map((t) => ({
    theme: t.id,
    accent: +contrast(t.tokens.accent, t.tokens.bg).toFixed(2),
    ok: +contrast(t.tokens.ok, t.tokens.bg).toFixed(2),
    warn: +contrast(t.tokens.warn, t.tokens.bg).toFixed(2),
    error: +contrast(t.tokens.error, t.tokens.bg).toFixed(2),
    info: +contrast(t.tokens.info, t.tokens.bg).toFixed(2),
  }));
  console.table(rows);
  expect(rows).toHaveLength(THEMES.length);
});
