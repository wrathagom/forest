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
  // chips). fgFaint maps to each palette's own published comment/muted tone,
  // and several palettes publish exactly one: Atom One's mono-3 (One Dark
  // 2.32:1, One Light 2.47:1) and Nord's #616e88, nord-vim's own brightened
  // comment colour (2.43:1) whose next official tone (nord4) is already
  // fgDim. There is no mapping choice to make in those cases, so 2.2 — not
  // 2.5 — is the floor: still enough to catch a genuine collapse toward the
  // background (nearer 1.0-1.5), without rejecting a palette's only muted
  // tone. Dracula's #6272a4 (~2.8:1) clears either number.
  test("the faint tier stays distinguishable", () => {
    expect(contrast(theme.tokens.fgFaint, theme.tokens.bg)).toBeGreaterThanOrEqual(2.2);
  });

  // accentFg is used in exactly one place — bold labels on accent-filled
  // controls (.m-btn) — where 3:1 is the applicable WCAG threshold, not the
  // 4.5:1 body-text threshold. 3.5 leaves a small margin above that floor.
  // Solarized's eight accents are deliberately mid-luminance so they work
  // against both its backgrounds, so nothing clears 4.5:1 against them (best
  // published tone is base03 at 4.08:1, checked across all eight monotones);
  // Rosé Pine Dawn's iris is mid-range for the same reason (best is surface
  // at 3.65:1).
  test("text on an accent fill clears 3.5:1", () => {
    expect(contrast(theme.tokens.accentFg, theme.tokens.accent)).toBeGreaterThanOrEqual(3.5);
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
