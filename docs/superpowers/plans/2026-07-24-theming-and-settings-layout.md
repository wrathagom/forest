# Themeable Forest + Settings Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forest's entire UI themeable with 16 built-in themes (Catppuccin's four flavors plus 11 others and today's Forest Dark), and restructure the settings page from a 480px single-column form into a sidebar layout with per-section save.

**Architecture:** A TypeScript theme registry is the single source of truth. `applyTheme()` writes 38 CSS custom properties onto `<html>`; CSS derives every tint with `color-mix()`; JS surfaces that cannot read CSS variables (xterm's canvas, mermaid's config) read the registry directly. The theme lives in `localStorage`, per-device. Settings becomes a parent route with a sidebar rail and one child route per section, each owning its own save button and unsaved-changes guard.

**Tech Stack:** SolidJS 1.9, `@solidjs/router` 0.16, Vite 8, Vitest 4 + `@solidjs/testing-library`, CodeMirror 6, xterm 6, mermaid 11. No server changes.

**Spec:** `docs/superpowers/specs/2026-07-24-theming-and-settings-layout-design.md`

---

## Spec amendment — contrast floors

The spec (§5) called for hard contrast floors of 3:1 on `accent`, `ok`, and `error` against `bg`. Working the numbers, that floor does not survive contact with published light palettes:

| Theme | Pair | Measured |
|---|---|---|
| Catppuccin Latte | `warn` `#df8e1d` on `bg` `#eff1f5` | **2.31:1** |
| Catppuccin Latte | `ok` `#40a02b` on `bg` `#eff1f5` | **2.96:1** |

These are Catppuccin Latte's own published green and yellow. Every Latte-themed app in existence has this contrast; it is the palette author's decision, not a mapping error on our part. Enforcing 3:1 would mean either failing the build on all four light Catppuccin-family themes or silently substituting colors users would notice as wrong.

**Revised rule, used by Task 12:**

- **Hard floors** on the pairs our *mapping* controls: `fg`/`bg` ≥ 4.5, `fgDim`/`bg` ≥ 3.0, `accentFg`/`accent` ≥ 4.5.
- **Gross-error floor of 2.0** on `accent`/`ok`/`warn`/`error`/`info` vs `bg`. This still catches the bug class that matters — a role mapped to the wrong palette entry, e.g. `ok` accidentally pointing at a surface color — without overriding upstream design decisions.
- The test **prints** the full role-contrast table so a reviewer sees real numbers rather than a silent pass.

Update the spec's §5 to match when Task 12 lands.

---

## File structure

**New — theme registry** (`web/src/lib/themes/`)

| File | Responsibility |
|---|---|
| `types.ts` | `Theme`, `ThemeTokens`, `ThemeScheme`, `TOKEN_KEYS` |
| `build.ts` | `ThemeInput` + `buildTheme()` — encodes the spec's mapping recipe once |
| `apply.ts` | `cssVarName()`, `applyTheme()`, boot-cache write |
| `current.ts` | `themeId` signal, `currentTheme()`, `setTheme()`, `initTheme()` |
| `index.ts` | `THEMES`, `THEME_BY_ID`, `DEFAULT_THEME_ID` |
| `forest-dark.ts`, `catppuccin.ts`, `dracula.ts`, `nord.ts`, `gruvbox.ts`, `tokyo-night.ts`, `one.ts`, `rose-pine.ts`, `solarized.ts` | Palette data, one file per family |

> **Deviation from spec:** the spec listed the current-theme signal as living in `index.ts`, and did not include `build.ts`. Splitting them keeps `index.ts` to registry assembly only, and `build.ts` makes the spec's "mapping recipe" table executable instead of copied into 16 files by hand. Same behavior, better boundaries.

**New — settings** (`web/src/components/settings/`): `AppearanceSection.tsx`, `DashboardSection.tsx`, `ScanSection.tsx`, `TerminalsSection.tsx`, `LaunchersSection.tsx`, `IntegrationsSection.tsx`, `SystemSection.tsx`, plus `web/src/lib/settings-dirty.ts` (`useUnsavedGuard`) and `web/src/lib/settings-config.ts` (shared config context).

**Modified:** `web/index.html` (boot script), `web/src/main.tsx` (init + routes), `web/src/styles.css` (tokens, `color-mix`, settings CSS), `web/src/pages/mobile/mobile.css`, `web/src/pages/Settings.tsx` (becomes a shell), `web/src/components/FileEditor.tsx`, `web/src/components/TerminalView.tsx`, `web/src/components/Markdown.tsx`, `web/src/components/charts/profileColors.ts`, `web/src/components/charts/TokensOverTimeChart.tsx`, `web/src/pages/mobile/MobileLayout.tsx`, `README.md`.

---

## Phase 1 — Registry foundation (Tasks 1–4)

Ends with: the app applies Forest Dark through the registry and looks pixel-identical to today.

### Task 1: Theme types

**Files:**
- Create: `web/src/lib/themes/types.ts`
- Test: `web/tests/theme-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/theme-types.test.ts
import { describe, expect, test } from "vitest";
import { TOKEN_KEYS } from "../src/lib/themes/types";

describe("TOKEN_KEYS", () => {
  test("lists all 38 tokens", () => {
    expect(TOKEN_KEYS).toHaveLength(38);
  });

  test("has no duplicates", () => {
    expect(new Set(TOKEN_KEYS).size).toBe(TOKEN_KEYS.length);
  });

  test("includes the role tokens the CSS depends on", () => {
    for (const key of ["bg", "bg2", "bg3", "accent", "accentFg", "ok", "warn", "error", "info"]) {
      expect(TOKEN_KEYS).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- theme-types`
Expected: FAIL — `Failed to resolve import "../src/lib/themes/types"`

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/themes/types.ts

// Light/dark drives the CSS `color-scheme` property, which is what makes
// native scrollbars and form controls follow the theme.
export type ThemeScheme = "light" | "dark";

export type ThemeTokens = {
  // surfaces
  bg: string; bg2: string; bg3: string;
  // text
  fg: string; fgDim: string; fgFaint: string;
  // lines
  border: string; borderStrong: string;
  // roles. `accent` is brand/selection; `ok` is positive state. They are
  // separate because Forest's accent happens to be green today, but under a
  // theme with a purple accent every added diff line would render purple.
  accent: string; accentFg: string;
  ok: string; warn: string; error: string; info: string;
  // codemirror syntax
  synKeyword: string; synString: string; synNumber: string;
  synFunction: string; synProperty: string; synType: string;
  synTag: string; synComment: string; synOperator: string; synInvalid: string;
  // categorical chart series
  chart1: string; chart2: string; chart3: string; chart4: string;
  chart5: string; chart6: string; chart7: string; chart8: string;
  // xterm (background/foreground/cursor only — ANSI 0-15 stay xterm's defaults)
  termBg: string; termFg: string; termCursor: string;
  // token meter
  tokIn: string; tokOut: string; tokCache: string;
};

export type Theme = {
  id: string;          // "catppuccin-mocha" — the value stored in localStorage
  name: string;        // "Mocha" — shown in the picker
  family: string;      // "Catppuccin" — groups cards in the picker
  scheme: ThemeScheme;
  tokens: ThemeTokens;
};

// Exhaustive by construction: omitting a ThemeTokens key here is a compile
// error, so TOKEN_KEYS can never drift from the type.
const TOKEN_KEY_MAP: Record<keyof ThemeTokens, true> = {
  bg: true, bg2: true, bg3: true,
  fg: true, fgDim: true, fgFaint: true,
  border: true, borderStrong: true,
  accent: true, accentFg: true, ok: true, warn: true, error: true, info: true,
  synKeyword: true, synString: true, synNumber: true, synFunction: true,
  synProperty: true, synType: true, synTag: true, synComment: true,
  synOperator: true, synInvalid: true,
  chart1: true, chart2: true, chart3: true, chart4: true,
  chart5: true, chart6: true, chart7: true, chart8: true,
  termBg: true, termFg: true, termCursor: true,
  tokIn: true, tokOut: true, tokCache: true,
};

export const TOKEN_KEYS = Object.keys(TOKEN_KEY_MAP) as (keyof ThemeTokens)[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- theme-types`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/themes/types.ts web/tests/theme-types.test.ts
git commit -m "feat(themes): theme token types and exhaustive key list"
```

---

### Task 2: `buildTheme` — the mapping recipe as code

**Files:**
- Create: `web/src/lib/themes/build.ts`
- Test: `web/tests/theme-build.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/theme-build.test.ts
import { describe, expect, test } from "vitest";
import { buildTheme, type ThemeInput } from "../src/lib/themes/build";
import { TOKEN_KEYS } from "../src/lib/themes/types";

const INPUT: ThemeInput = {
  id: "t", name: "T", family: "F", scheme: "dark",
  bg: "#000000", bg2: "#010101", bg3: "#020202",
  fg: "#ffffff", fgDim: "#cccccc", fgFaint: "#888888",
  border: "#020202", borderStrong: "#030303",
  accent: "#aa00ff", accentFg: "#000000",
  ok: "#00ff00", warn: "#ffff00", error: "#ff0000", info: "#0000ff",
  purple: "#aa00ff", green: "#00ff00", orange: "#ff8800", blue: "#0000ff",
  cyan: "#00ffff", yellow: "#ffff00", red: "#ff0000", pink: "#ff00ff",
  teal: "#008888", comment: "#666666",
};

describe("buildTheme", () => {
  test("produces every token", () => {
    const theme = buildTheme(INPUT);
    for (const key of TOKEN_KEYS) {
      expect(theme.tokens[key], `missing ${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("applies the syntax recipe", () => {
    const { tokens } = buildTheme(INPUT);
    expect(tokens.synKeyword).toBe(INPUT.purple);
    expect(tokens.synString).toBe(INPUT.green);
    expect(tokens.synComment).toBe(INPUT.comment);
  });

  test("terminal defaults to bg/fg/accent", () => {
    const { tokens } = buildTheme(INPUT);
    expect(tokens.termBg).toBe(INPUT.bg);
    expect(tokens.termFg).toBe(INPUT.fg);
    expect(tokens.termCursor).toBe(INPUT.accent);
  });

  test("overrides win", () => {
    const { tokens } = buildTheme({ ...INPUT, overrides: { termBg: "#123456", chart1: "#654321" } });
    expect(tokens.termBg).toBe("#123456");
    expect(tokens.chart1).toBe("#654321");
    expect(tokens.termFg).toBe(INPUT.fg); // untouched
  });

  test("role colors default to the matching hue", () => {
    // Most published palettes use one value for both, so a theme that omits
    // these should fall back to green/yellow/red/blue.
    const withoutRoles: ThemeInput = { ...INPUT };
    delete withoutRoles.ok;
    delete withoutRoles.warn;
    delete withoutRoles.error;
    delete withoutRoles.info;
    const { tokens } = buildTheme(withoutRoles);
    expect(tokens.ok).toBe(INPUT.green);
    expect(tokens.warn).toBe(INPUT.yellow);
    expect(tokens.error).toBe(INPUT.red);
    expect(tokens.info).toBe(INPUT.blue);
  });

  test("an explicit role color wins over the hue default", () => {
    const { tokens } = buildTheme({ ...INPUT, ok: "#123123", green: "#00ff00" });
    expect(tokens.ok).toBe("#123123");
    expect(tokens.synString).toBe("#00ff00"); // the hue still drives syntax
  });

  test("charts default to the eight named hues", () => {
    const { tokens } = buildTheme(INPUT);
    expect(tokens.chart1).toBe(INPUT.blue);
    expect(tokens.chart2).toBe(INPUT.pink);
    expect(tokens.chart8).toBe(INPUT.teal);
  });

  test("a charts tuple replaces the derived series", () => {
    const charts = [
      "#111111", "#222222", "#333333", "#444444",
      "#555555", "#666666", "#777777", "#888888",
    ] as const;
    const { tokens } = buildTheme({ ...INPUT, charts });
    expect([
      tokens.chart1, tokens.chart2, tokens.chart3, tokens.chart4,
      tokens.chart5, tokens.chart6, tokens.chart7, tokens.chart8,
    ]).toEqual([...charts]);
  });

  test("carries identity through", () => {
    const theme = buildTheme(INPUT);
    expect(theme.id).toBe("t");
    expect(theme.family).toBe("F");
    expect(theme.scheme).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- theme-build`
Expected: FAIL — cannot resolve `../src/lib/themes/build`

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/themes/build.ts
import type { Theme, ThemeScheme, ThemeTokens } from "./types";

// A theme is authored as its own published palette plus role assignments.
// buildTheme expands that into the full 38-token set using the mapping recipe
// from the design doc, so the recipe lives in exactly one place instead of
// being copy-pasted into 16 theme files.
export type ThemeInput = {
  id: string;
  name: string;
  family: string;
  scheme: ThemeScheme;

  // surfaces / text / lines
  bg: string; bg2: string; bg3: string;
  fg: string; fgDim: string; fgFaint: string;
  border: string; borderStrong: string;

  // roles
  accent: string; accentFg: string;

  // Default to the theme's corresponding hue, because in most published
  // palettes they are literally the same value — Catppuccin's `ok` IS its
  // green. Pass one explicitly only where it differs: Forest Dark's success
  // green (#6ee7b7) is not its syntax-string green (#c3e88d).
  ok?: string; warn?: string; error?: string; info?: string;

  // named hues, used to derive syntax and chart colors
  purple: string; green: string; orange: string; blue: string;
  cyan: string; yellow: string; red: string; pink: string;
  teal: string; comment: string;

  // Categorical chart series. Defaults to the eight named hues, which only
  // works for palettes that publish eight distinct ones. Most families
  // collapse at least two — Dracula's blue and cyan are the same hex — so
  // they pass a tuple. A tuple rather than eight `chartN` override lines
  // keeps the "8 distinct colors" requirement visible where it is authored.
  charts?: readonly [string, string, string, string, string, string, string, string];

  // Last-resort escape hatch for a single token that fits no other rule.
  overrides?: Partial<ThemeTokens>;
};

export function buildTheme(i: ThemeInput): Theme {
  const ok = i.ok ?? i.green;
  const warn = i.warn ?? i.yellow;
  const error = i.error ?? i.red;
  const info = i.info ?? i.blue;
  const charts =
    i.charts ?? [i.blue, i.pink, i.green, i.yellow, i.purple, i.cyan, i.orange, i.teal];

  const tokens: ThemeTokens = {
    bg: i.bg, bg2: i.bg2, bg3: i.bg3,
    fg: i.fg, fgDim: i.fgDim, fgFaint: i.fgFaint,
    border: i.border, borderStrong: i.borderStrong,
    accent: i.accent, accentFg: i.accentFg,
    ok, warn, error, info,

    synKeyword: i.purple,
    synString: i.green,
    synNumber: i.orange,
    synFunction: i.blue,
    synProperty: i.cyan,
    synType: i.yellow,
    synTag: i.red,
    synComment: i.comment,
    synOperator: i.cyan,
    synInvalid: i.red,

    chart1: charts[0], chart2: charts[1], chart3: charts[2], chart4: charts[3],
    chart5: charts[4], chart6: charts[5], chart7: charts[6], chart8: charts[7],

    termBg: i.bg, termFg: i.fg, termCursor: i.accent,

    tokIn: i.green, tokOut: i.orange, tokCache: i.purple,

    ...i.overrides,
  };

  return { id: i.id, name: i.name, family: i.family, scheme: i.scheme, tokens };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- theme-build`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/themes/build.ts web/tests/theme-build.test.ts
git commit -m "feat(themes): buildTheme encodes the palette mapping recipe"
```

---

### Task 3: `applyTheme` and the boot cache

**Files:**
- Create: `web/src/lib/themes/apply.ts`
- Test: `web/tests/theme-apply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/theme-apply.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { applyTheme, cssVarName, BOOT_CACHE_KEY } from "../src/lib/themes/apply";
import { buildTheme } from "../src/lib/themes/build";
import { TOKEN_KEYS } from "../src/lib/themes/types";

const theme = buildTheme({
  id: "test-theme", name: "Test", family: "Test", scheme: "light",
  bg: "#ffffff", bg2: "#eeeeee", bg3: "#dddddd",
  fg: "#111111", fgDim: "#555555", fgFaint: "#888888",
  border: "#dddddd", borderStrong: "#cccccc",
  accent: "#8839ef", accentFg: "#ffffff",
  ok: "#40a02b", warn: "#df8e1d", error: "#d20f39", info: "#1e66f5",
  purple: "#8839ef", green: "#40a02b", orange: "#fe640b", blue: "#1e66f5",
  cyan: "#04a5e5", yellow: "#df8e1d", red: "#d20f39", pink: "#ea76cb",
  teal: "#179299", comment: "#8c8fa1",
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("cssVarName", () => {
  test.each([
    ["bg", "--bg"],
    ["bg2", "--bg-2"],
    ["fgDim", "--fg-dim"],
    ["borderStrong", "--border-strong"],
    ["synKeyword", "--syn-keyword"],
    ["chart1", "--chart-1"],
    ["termBg", "--term-bg"],
    ["tokIn", "--tok-in"],
  ])("%s -> %s", (key, expected) => {
    expect(cssVarName(key)).toBe(expected);
  });
});

describe("applyTheme", () => {
  test("writes every token as a custom property", () => {
    applyTheme(theme);
    const style = document.documentElement.style;
    for (const key of TOKEN_KEYS) {
      expect(style.getPropertyValue(cssVarName(key)), `missing ${key}`).toBe(theme.tokens[key]);
    }
  });

  test("sets color-scheme and data-theme", () => {
    applyTheme(theme);
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("test-theme");
  });

  test("writes the boot cache the inline script reads", () => {
    applyTheme(theme);
    expect(JSON.parse(localStorage.getItem(BOOT_CACHE_KEY)!)).toEqual({
      bg: "#ffffff", fg: "#111111", scheme: "light",
    });
  });

  test("survives localStorage being unavailable", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("quota"); };
    try {
      expect(() => applyTheme(theme)).not.toThrow();
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#ffffff");
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- theme-apply`
Expected: FAIL — cannot resolve `../src/lib/themes/apply`

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/themes/apply.ts
import type { Theme, ThemeTokens } from "./types";
import { TOKEN_KEYS } from "./types";

// Read by the blocking script in index.html before first paint. Holds only the
// three values that prevent a visible flash; the other 35 land microseconds
// later when the module evaluates.
export const BOOT_CACHE_KEY = "forest.theme.boot";

// camelCase token key -> CSS custom property. Digits count as boundaries so
// `bg2` becomes `--bg-2` and `chart1` becomes `--chart-1`.
export function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const key of TOKEN_KEYS) {
    root.style.setProperty(cssVarName(key), theme.tokens[key as keyof ThemeTokens]);
  }
  // setProperty rather than `root.style.colorScheme` so the write is observable
  // in jsdom, which does not implement the camelCase alias.
  root.style.setProperty("color-scheme", theme.scheme);
  root.dataset.theme = theme.id;
  writeBootCache(theme);
}

function writeBootCache(theme: Theme): void {
  try {
    localStorage.setItem(
      BOOT_CACHE_KEY,
      JSON.stringify({ bg: theme.tokens.bg, fg: theme.tokens.fg, scheme: theme.scheme }),
    );
  } catch {
    // private mode / quota / disabled — the theme still applies this session,
    // the next load just repaints once. Not worth surfacing.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- theme-apply`
Expected: PASS, 12 tests (8 parameterized + 4)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/themes/apply.ts web/tests/theme-apply.test.ts
git commit -m "feat(themes): applyTheme writes custom properties and boot cache"
```

---

### Task 4: Forest Dark + registry + wire-up

**Files:**
- Create: `web/src/lib/themes/forest-dark.ts`, `web/src/lib/themes/index.ts`, `web/src/lib/themes/current.ts`
- Modify: `web/index.html`, `web/src/main.tsx`
- Test: `web/tests/theme-current.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/theme-current.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { currentTheme, setTheme, themeId, initTheme } from "../src/lib/themes/current";
import { DEFAULT_THEME_ID, THEMES } from "../src/lib/themes/index";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("current theme", () => {
  test("defaults to Forest Dark", () => {
    createRoot(() => {
      expect(themeId()).toBe(DEFAULT_THEME_ID);
      expect(currentTheme().id).toBe("forest-dark");
    });
  });

  test("setTheme persists and applies", () => {
    createRoot(() => {
      setTheme("forest-dark");
      expect(localStorage.getItem("forest.theme")).toBe(JSON.stringify("forest-dark"));
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#0e0e10");
    });
  });

  test("an unknown stored id falls back to the default", () => {
    localStorage.setItem("forest.theme", JSON.stringify("does-not-exist"));
    createRoot(() => {
      expect(currentTheme().id).toBe(DEFAULT_THEME_ID);
    });
  });

  test("initTheme applies without changing the stored id", () => {
    createRoot(() => {
      initTheme();
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#6ee7b7");
    });
  });
});

describe("Forest Dark preserves today's look", () => {
  const forest = THEMES.find((t) => t.id === "forest-dark")!;
  test.each([
    ["bg", "#0e0e10"], ["bg2", "#1a1a1d"], ["fg", "#e6e6e6"], ["fgDim", "#9a9a9a"],
    ["border", "#2a2a2d"], ["accent", "#6ee7b7"], ["ok", "#6ee7b7"],
    ["warn", "#f59e0b"], ["error", "#f87171"],
    ["tokIn", "#6ee7b7"], ["tokOut", "#f59e0b"], ["tokCache", "#8b5cf6"],
    ["synKeyword", "#c792ea"], ["synString", "#c3e88d"], ["synComment", "#546e7a"],
    ["synInvalid", "#ff5370"], ["chart1", "#60a5fa"], ["chart8", "#a3e635"],
  ] as const)("%s is unchanged", (key, expected) => {
    expect(forest.tokens[key]).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- theme-current`
Expected: FAIL — cannot resolve `../src/lib/themes/current`

- [ ] **Step 3: Write Forest Dark**

Every value is lifted from today's `styles.css`, `FileEditor.tsx`, and `profileColors.ts`, so selecting this theme is a no-op visually.

```ts
// web/src/lib/themes/forest-dark.ts
import { buildTheme } from "./build";

// Forest's original palette. Values come straight from styles.css, the
// CodeMirror highlight in FileEditor.tsx, and PROFILE_PALETTE, so this theme
// is byte-identical to the pre-theming look.
export const forestDark = buildTheme({
  id: "forest-dark", name: "Forest Dark", family: "Forest", scheme: "dark",

  bg: "#0e0e10", bg2: "#1a1a1d", bg3: "#0e0e10",
  fg: "#e6e6e6", fgDim: "#9a9a9a", fgFaint: "#666666",
  border: "#2a2a2d", borderStrong: "#3a3a3d",

  accent: "#6ee7b7", accentFg: "#0e0e10",

  // Forest Dark is the one theme where the role colors genuinely differ from
  // the syntax hues, so they are explicit: the success green is the accent
  // green (#6ee7b7), not the string green (#c3e88d). `info` is omitted because
  // it equals `blue` and the default already produces it.
  ok: "#6ee7b7", warn: "#f59e0b", error: "#f87171",

  purple: "#c792ea", green: "#c3e88d", orange: "#f78c6c", blue: "#82aaff",
  cyan: "#89ddff", yellow: "#ffcb6b", red: "#f07178", pink: "#f472b6",
  teal: "#34d399", comment: "#546e7a",

  // The exact PROFILE_PALETTE from charts/profileColors.ts, so existing charts
  // do not shift colour when this theme is applied.
  charts: [
    "#60a5fa", "#f472b6", "#34d399", "#fbbf24",
    "#a78bfa", "#22d3ee", "#fb923c", "#a3e635",
  ],

  overrides: {
    // CodeMirror used a distinct invalid red, not the tag red.
    synInvalid: "#ff5370",
    // The token meter had its own violet.
    tokIn: "#6ee7b7", tokOut: "#f59e0b", tokCache: "#8b5cf6",
  },
});
```

- [ ] **Step 4: Write the registry**

```ts
// web/src/lib/themes/index.ts
import type { Theme } from "./types";
import { forestDark } from "./forest-dark";

export type { Theme, ThemeTokens, ThemeScheme } from "./types";
export { TOKEN_KEYS } from "./types";
export { applyTheme, cssVarName, BOOT_CACHE_KEY } from "./apply";

// Order here is the order families appear in the theme picker.
export const THEMES: Theme[] = [forestDark];

export const DEFAULT_THEME_ID = forestDark.id;

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
);
```

- [ ] **Step 5: Write the current-theme signal**

```ts
// web/src/lib/themes/current.ts
import { persistedSignal } from "../persisted";
import { applyTheme } from "./apply";
import { DEFAULT_THEME_ID, THEME_BY_ID } from "./index";
import type { Theme } from "./types";

// Per-device, following the autoRefresh precedent in lib/preferences.ts.
// Stored under "forest.theme".
const [themeId, setThemeId] = persistedSignal("theme", DEFAULT_THEME_ID);

export { themeId };

// A plain function rather than a memo: it reads themeId() so it stays
// reactive, and avoids creating a computation outside a reactive root.
export function currentTheme(): Theme {
  return THEME_BY_ID[themeId()] ?? THEME_BY_ID[DEFAULT_THEME_ID]!;
}

export function setTheme(id: string): void {
  setThemeId(id);
  applyTheme(currentTheme());
}

// Called once from main.tsx before render.
export function initTheme(): void {
  applyTheme(currentTheme());
}
```

- [ ] **Step 6: Add the no-flash boot script**

In `web/index.html`, insert immediately before `</head>`:

```html
    <script>
      // Applies the last-used background/foreground before first paint. The
      // full token set lands when the module bundle evaluates; this only
      // prevents a light/dark flash on load. Written by applyTheme().
      try {
        var b = JSON.parse(localStorage.getItem("forest.theme.boot") || "null");
        if (b && b.bg && b.fg && b.scheme) {
          var s = document.documentElement.style;
          s.setProperty("--bg", b.bg);
          s.setProperty("--fg", b.fg);
          s.setProperty("color-scheme", b.scheme);
        }
      } catch (e) {}
    </script>
```

- [ ] **Step 7: Initialize on boot**

In `web/src/main.tsx`, add the import and call before `render(...)`:

```ts
import { initTheme } from "./lib/themes/current";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
initTheme();
render(
```

- [ ] **Step 8: Run tests**

Run: `cd web && bun run test -- theme-current`
Expected: PASS, 22 tests

- [ ] **Step 9: Verify the app is visually unchanged**

Run: `bun run dev:web`, open http://localhost:5173, confirm the dashboard, a project's terminal, and the file editor look exactly as before. In DevTools, confirm `<html>` carries `data-theme="forest-dark"` and ~38 `--*` properties.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/themes/ web/tests/theme-current.test.ts web/index.html web/src/main.tsx
git commit -m "feat(themes): registry, Forest Dark, and flash-free boot"
```

---

## Phase 2 — CSS conversion (Tasks 5–7)

Ends with: `styles.css` and `mobile.css` contain no hardcoded colors, and Forest Dark still renders identically.

### Task 5: Add the new tokens to `:root` and split accent from ok

**Files:**
- Modify: `web/src/styles.css:16-30` (the `:root` block), plus the selectors listed below

- [ ] **Step 1: Replace the `:root` block**

`applyTheme` now owns every color and `color-scheme`. What remains in CSS is the font stack plus fallback values, so the stylesheet still renders standalone (e.g. in a test harness that never calls `applyTheme`).

```css
:root {
  /* Fallbacks only — applyTheme() overwrites all of these on <html> at boot.
     Kept so the stylesheet is legible on its own and so a JS failure degrades
     to the original Forest Dark look rather than to unstyled black-on-white. */
  --bg: #0e0e10;
  --bg-2: #1a1a1d;
  --bg-3: #0e0e10;
  --fg: #e6e6e6;
  --fg-dim: #9a9a9a;
  --fg-faint: #666666;
  --border: #2a2a2d;
  --border-strong: #3a3a3d;
  --accent: #6ee7b7;
  --accent-fg: #0e0e10;
  --ok: #6ee7b7;
  --warn: #f59e0b;
  --error: #f87171;
  --info: #82aaff;
  --tok-in: #6ee7b7;
  --tok-out: #f59e0b;
  --tok-cache: #8b5cf6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

Note `color-scheme: dark` is **removed** — `applyTheme` sets it per theme.

- [ ] **Step 2: Reassign positive-state selectors from `--accent` to `--ok`**

These are the selectors that mean "good / added / running / done", not "brand / selected". Change `var(--accent)` to `var(--ok)` and any `rgba(110,231,183,X)` to `color-mix(in srgb, var(--ok) X%, transparent)` in each:

| Selector | Meaning |
|---|---|
| `.git-ahead` | commits ahead |
| `.dot-ok` | healthy dot |
| `.svc-running` | running service count |
| `.svc-terminals` | live terminal count |
| `.banner-ok` | success banner |
| `.tree-badge-A` | git "added" badge |
| `.git-branch-ahead` | branch ahead marker |
| `.diff-add` | added diff line |
| `.sessions-dot.live` | live session dot |
| `.session-chip-dot-working` | working session dot |
| `.tasks-dot-done` | completed task dot |
| `.caffeinate-on` | caffeinate active |

Every other `var(--accent)` usage stays as-is — those are brand and selection (`.brand-mark`, `.tab.active`, `.pin`, `.tree-file-active`, `.info-toggle`, `.launcher-*`, `.modal-actions button[type="submit"]`, `.subdir-chip`, `.markdown-body a`, `.msg-user *`, `.task-view-link`, and the rest).

- [ ] **Step 3: Verify the diff-view colors**

```css
.diff-add { background: color-mix(in srgb, var(--ok) 10%, transparent); color: var(--ok); }
.diff-del { background: color-mix(in srgb, var(--error) 12%, transparent); color: var(--error); }
.diff-hunk { color: var(--info); }
```

- [ ] **Step 4: Check it still builds and looks right**

Run: `cd web && bun run build`
Expected: build succeeds.

Then `bun run dev:web` and confirm a project's git tab, a diff, and the dashboard cards look unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css
git commit -m "refactor(css): add role tokens and split --ok from --accent"
```

---

### Task 6: Convert every remaining hardcoded color

**Files:**
- Modify: `web/src/styles.css`, `web/src/pages/mobile/mobile.css`

- [ ] **Step 1: Apply the literal-to-token mapping**

Work through both files. Every literal below has exactly one replacement. Whitespace inside `rgba()` varies in the source (`rgba(110,231,183,0.08)` and `rgba(110, 231, 183, 0.08)` both occur) — handle both.

| Literal | Replacement |
|---|---|
| `#0e0e10` | `var(--bg)` |
| `#1a1a1d` | `var(--bg-2)` |
| `#2a2a2d` | `var(--border)` |
| `#3a3a3d` | `var(--border-strong)` |
| `#e6e6e6` | `var(--fg)` |
| `#555` | `var(--fg-faint)` |
| `var(--muted, #888)` | `var(--fg-faint)` |
| `#6ee7b7` | `var(--accent)` (or `var(--ok)` per Task 5) |
| `#82aaff` | `var(--info)` |
| `#86efac` | `var(--ok)` |
| `#fca5a5` | `var(--error)` |
| `rgba(110,231,183,X)` | `color-mix(in srgb, var(--accent) X%, transparent)` |
| `rgba(245,158,11,X)` | `color-mix(in srgb, var(--warn) X%, transparent)` |
| `rgba(248,113,113,X)` | `color-mix(in srgb, var(--error) X%, transparent)` |
| `rgba(127,127,127,X)` | `color-mix(in srgb, var(--fg-faint) X%, transparent)` |
| `rgba(255,255,255,X)` | `color-mix(in srgb, var(--fg) X%, transparent)` |
| `rgba(14, 14, 16, 0.85)` | `color-mix(in srgb, var(--bg) 85%, transparent)` |

Alpha converts directly to a percentage: `0.08` → `8%`, `0.35` → `35%`, `0.055` → `5.5%`.

**Two deliberate exceptions — leave these as literal black:**

```css
.modal-backdrop { background: rgba(0, 0, 0, 0.65); }   /* scrim, correct on light themes too */
.launcher-menu  { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }  /* shadows are black, not themed */
```

- [ ] **Step 2: Verify no hardcoded colors remain**

```bash
grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' web/src/styles.css web/src/pages/mobile/mobile.css \
  | grep -v 'rgba(0, 0, 0' | grep -v '^\S*:1[6-9]:\|^\S*:[2-3][0-9]:'
```

Expected: only the `:root` fallback block from Task 5. Anything else is a miss.

- [ ] **Step 3: Confirm the app is unchanged**

Run: `bun run dev:web` and walk the dashboard, a project detail page (all tabs), the sessions page, and `/m`. Forest Dark should be indistinguishable from `main`.

- [ ] **Step 4: Run the full web suite**

Run: `cd web && bun run test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css web/src/pages/mobile/mobile.css
git commit -m "refactor(css): derive every tint from tokens via color-mix"
```

---

### Task 7: Settings CSS for the new layout

**Files:**
- Modify: `web/src/styles.css` (the `.settings` block, currently around lines 79-93)

- [ ] **Step 1: Replace the `.settings` rules**

`max-width: 480px` is the direct cause of the one-third-width complaint. The `.subdir-*` and `.launcher-*` rules stay as they are.

```css
/* settings shell — rail + section pane */
.settings-shell { display: grid; grid-template-columns: 160px 1fr; gap: 1.2rem; align-items: start; }
.settings-rail { display: flex; flex-direction: column; gap: 1px; position: sticky; top: 0; }
.settings-rail a {
  padding: 0.3rem 0.6rem; color: var(--fg-dim); text-decoration: none;
  font-size: 0.85rem; border-left: 2px solid transparent; border-radius: 0 3px 3px 0;
}
.settings-rail a:hover { color: var(--fg); }
.settings-rail a.active {
  color: var(--accent); border-left-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.settings-pane { min-width: 0; max-width: 900px; }
.settings-pane h3 {
  margin: 0 0 0.8rem; font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--fg-dim); font-weight: 600;
}
.settings-fields { display: flex; flex-direction: column; gap: 0.8rem; max-width: 480px; }
.settings-fields label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: var(--fg-dim); }
.settings-fields input {
  background: var(--bg-2); color: var(--fg); border: 1px solid var(--border);
  padding: 0.4rem; border-radius: 4px; font: inherit;
}
.settings-save { display: flex; gap: 0.5rem; align-items: center; margin-top: 1rem; }
.settings-save button {
  background: var(--bg-2); color: var(--fg); border: 1px solid var(--border);
  padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font: inherit;
}
.settings-save button[type="submit"]:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.settings-save button:disabled { opacity: 0.5; cursor: not-allowed; }
.settings-saved { color: var(--ok); font-size: 0.8rem; }

@media (max-width: 700px) {
  .settings-shell { grid-template-columns: 1fr; gap: 0.8rem; }
  .settings-rail {
    flex-direction: row; overflow-x: auto; position: static;
    border-bottom: 1px solid var(--border); padding-bottom: 0.3rem;
  }
  .settings-rail a { white-space: nowrap; border-left: 0; border-bottom: 2px solid transparent; border-radius: 3px 3px 0 0; }
  .settings-rail a.active { border-left: 0; border-bottom-color: var(--accent); }
}
```

- [ ] **Step 2: Add theme-picker and guard-dialog rules**

```css
/* theme picker */
.theme-family { margin-bottom: 1.2rem; }
.theme-family-name { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-dim); margin-bottom: 0.4rem; }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.6rem; }
.theme-card {
  border: 1px solid var(--border); border-radius: 4px; overflow: hidden;
  cursor: pointer; padding: 0; background: none; font: inherit; text-align: left;
}
.theme-card:hover { border-color: var(--fg-dim); }
.theme-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.theme-swatch { display: flex; height: 34px; }
.theme-swatch span { flex: 1; }
.theme-card-name { padding: 0.25rem 0.5rem; font-size: 0.78rem; color: var(--fg-dim); background: var(--bg-2); }
.theme-card.active .theme-card-name { color: var(--accent); }

/* unsaved-changes dialog */
.guard-dialog { background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; padding: 0; max-width: 420px; color: var(--fg); }
.guard-dialog::backdrop { background: rgba(0, 0, 0, 0.65); }
.guard-dialog-body { padding: 0.9rem; display: flex; flex-direction: column; gap: 0.7rem; }
.guard-dialog-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.guard-dialog-actions button {
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font: inherit;
}
.guard-dialog-actions button.primary { border-color: var(--accent); color: var(--accent); }
.guard-dialog-actions button.danger:hover { border-color: var(--error); color: var(--error); }
```

- [ ] **Step 3: Verify the build**

Run: `cd web && bun run build`
Expected: succeeds. The settings page will look broken until Phase 5 — that is expected, since the markup does not exist yet.

- [ ] **Step 4: Commit**

```bash
git add web/src/styles.css
git commit -m "feat(css): settings shell, theme picker, and guard dialog styles"
```

---

## Phase 3 — JS surfaces (Tasks 8–11)

Ends with: editor, terminal, mermaid, and charts all follow the theme.

### Task 8: CodeMirror

**Files:**
- Modify: `web/src/components/FileEditor.tsx:23-64`
- Test: `web/tests/FileEditor.test.tsx` (existing — must keep passing)

- [ ] **Step 1: Replace the highlight style and theme**

CodeMirror compiles both of these to real CSS via StyleModule, so `var()` works and the editor recolors itself with no subscription.

```ts
const forestHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: t.controlKeyword, color: "var(--syn-keyword)" },
  { tag: t.moduleKeyword, color: "var(--syn-keyword)" },
  { tag: t.definitionKeyword, color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.tagName], color: "var(--syn-tag)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: t.operator, color: "var(--syn-operator)" },
  { tag: [t.regexp, t.escape, t.special(t.escape)], color: "var(--syn-operator)" },
  { tag: t.heading, color: "var(--syn-keyword)", fontWeight: "bold" },
  { tag: t.link, color: "var(--syn-function)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
]);

const forestTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "var(--bg)", color: "var(--fg)", height: "100%", fontSize: "13px" },
    ".cm-content": {
      fontFamily:
        '"FiraCode Nerd Font Mono", "FiraCode Nerd Font", ui-monospace, Menlo, monospace',
      caretColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg)",
      color: "var(--fg-faint)",
      border: "0",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 2%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--fg) 2%, transparent)" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)",
    },
  },
  // `dark: true` only selects CodeMirror's built-in dark base styles. Since
  // every color above is a token, this no longer needs to track the theme.
  { dark: true },
);
```

- [ ] **Step 2: Run the editor tests**

Run: `cd web && bun run test -- FileEditor`
Expected: PASS — no assertions depend on literal colors.

- [ ] **Step 3: Verify visually**

Run `bun run dev:web`, open a project, open a `.ts` file. Syntax highlighting should look identical to before.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FileEditor.tsx
git commit -m "feat(editor): drive CodeMirror colors from theme tokens"
```

---

### Task 9: xterm

**Files:**
- Modify: `web/src/components/TerminalView.tsx:66-70`
- Test: `web/tests/TerminalView.theme.test.ts` (new)

- [ ] **Step 1: Write the failing test**

The terminal itself needs a real DOM and WebGL, so test the mapping function rather than the widget.

```ts
// web/tests/TerminalView.theme.test.ts
import { describe, expect, test } from "vitest";
import { xtermTheme } from "../src/components/TerminalView";
import { buildTheme } from "../src/lib/themes/build";

const theme = buildTheme({
  id: "x", name: "X", family: "X", scheme: "dark",
  bg: "#1e1e2e", bg2: "#181825", bg3: "#313244",
  fg: "#cdd6f4", fgDim: "#a6adc8", fgFaint: "#6c7086",
  border: "#313244", borderStrong: "#45475a",
  accent: "#cba6f7", accentFg: "#11111b",
  ok: "#a6e3a1", warn: "#f9e2af", error: "#f38ba8", info: "#89b4fa",
  purple: "#cba6f7", green: "#a6e3a1", orange: "#fab387", blue: "#89b4fa",
  cyan: "#89dceb", yellow: "#f9e2af", red: "#f38ba8", pink: "#f5c2e7",
  teal: "#94e2d5", comment: "#7f849c",
});

describe("xtermTheme", () => {
  test("maps background, foreground and cursor", () => {
    expect(xtermTheme(theme)).toEqual({
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#cba6f7",
    });
  });

  test("sets no ANSI slots, leaving xterm's defaults alone", () => {
    const keys = Object.keys(xtermTheme(theme));
    expect(keys).toHaveLength(3);
    expect(keys.some((k) => /^(bright)?(black|red|green|yellow|blue|magenta|cyan|white)$/.test(k))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- TerminalView.theme`
Expected: FAIL — `xtermTheme` is not exported.

- [ ] **Step 3: Export the mapping and use it**

Add near the top of `web/src/components/TerminalView.tsx`:

```ts
import type { ITheme } from "@xterm/xterm";
import type { Theme } from "../lib/themes/types";
import { currentTheme } from "../lib/themes/current";

// Only background/foreground/cursor. ANSI 0-15 are deliberately left to
// xterm's defaults: programs in the PTY pick their own colors, and modern
// prompts emit 24-bit truecolor that no theme should override.
export function xtermTheme(theme: Theme): ITheme {
  return {
    background: theme.tokens.termBg,
    foreground: theme.tokens.termFg,
    cursor: theme.tokens.termCursor,
  };
}
```

Replace the literal `theme:` block in the `new Terminal({...})` call:

```ts
      theme: xtermTheme(currentTheme()),
```

- [ ] **Step 4: Re-apply on theme change**

Inside the same `onMount` where `term` is created, after `term.open(host)`, add:

```ts
    // currentTheme() reads the themeId signal, so this re-runs on every change.
    createEffect(() => {
      const t = currentTheme();
      if (term) term.options.theme = xtermTheme(t);
    });
```

Add `createEffect` to the existing `solid-js` import on line 1.

- [ ] **Step 5: Run tests**

Run: `cd web && bun run test -- TerminalView`
Expected: PASS, including any existing TerminalView tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/TerminalView.tsx web/tests/TerminalView.theme.test.ts
git commit -m "feat(terminal): follow theme background, foreground and cursor"
```

---

### Task 10: mermaid

**Files:**
- Modify: `web/src/components/Markdown.tsx:7`
- Test: `web/tests/Markdown.test.tsx` (existing — must keep passing)

- [ ] **Step 1: Replace the fixed dark theme**

`theme: "dark"` is wrong on light themes. `theme: "base"` plus `themeVariables` lets the registry drive it.

```ts
import { currentTheme } from "../lib/themes/current";

// mermaid's "base" theme is the only one that honours themeVariables. Called
// again on theme change because mermaid caches its config at initialize time.
function initMermaid(): void {
  const { tokens } = currentTheme();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: tokens.bg,
      mainBkg: tokens.bg2,
      primaryColor: tokens.bg2,
      primaryTextColor: tokens.fg,
      primaryBorderColor: tokens.border,
      secondaryColor: tokens.bg3,
      tertiaryColor: tokens.bg3,
      lineColor: tokens.fgDim,
      textColor: tokens.fg,
      nodeBorder: tokens.borderStrong,
    },
  });
}

initMermaid();
```

- [ ] **Step 2: Re-initialize and re-render on theme change**

In the `Markdown` component, alongside the existing render effect:

```ts
  // Re-initialize mermaid and re-render every already-rendered diagram when the
  // theme changes. Rendered blocks carry .mermaid-rendered; resetting them to
  // .mermaid-pending puts them back through the existing render path.
  createEffect(() => {
    currentTheme();
    initMermaid();
    host?.querySelectorAll<HTMLElement>("pre.mermaid-rendered").forEach((el) => {
      el.className = "mermaid-pending";
      el.textContent = "";
      void renderMermaid(el);
    });
  });
```

> If `renderMermaid` reads its source from `data-src`, clearing `textContent` is safe. Confirm that when implementing — if the source lives in the text content instead, keep it and only clear the injected SVG.

- [ ] **Step 3: Run tests**

Run: `cd web && bun run test -- Markdown`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Markdown.tsx
git commit -m "feat(markdown): drive mermaid diagram colors from the theme"
```

---

### Task 11: Charts

**Files:**
- Modify: `web/src/components/charts/profileColors.ts`, `web/src/components/charts/TokensOverTimeChart.tsx:48`
- Test: `web/tests/charts.test.tsx` (existing — must keep passing)

- [ ] **Step 1: Read the palette from the registry**

```ts
// web/src/components/charts/profileColors.ts
import { currentTheme } from "../../lib/themes/current";

// Categorical palette for per-profile chart series, read from the active theme.
// These are applied as SVG fill attributes in JS, so they must be literal
// colors — `var(--chart-1)` would not resolve in an attribute context.
export function profilePalette(): string[] {
  const { tokens } = currentTheme();
  return [
    tokens.chart1, tokens.chart2, tokens.chart3, tokens.chart4,
    tokens.chart5, tokens.chart6, tokens.chart7, tokens.chart8,
  ];
}

// Maps profile keys (in the caller's stable order) to palette colors, cycling
// if there are more profiles than colors. Consumers (time chart + legend) share
// this map so a profile always gets the same color.
export function profileColorMap(profiles: string[]): Record<string, string> {
  const palette = profilePalette();
  const map: Record<string, string> = {};
  profiles.forEach((p, i) => {
    map[p] = palette[i % palette.length]!;
  });
  return map;
}
```

- [ ] **Step 2: Update the fallback in the time chart**

In `TokensOverTimeChart.tsx` line 48, replace the literal fallback:

```ts
          segments.push({ y: baseY - acc - h, h, color: colors[p] ?? "var(--fg-faint)" });
```

> If that value is used as an SVG `fill` attribute rather than a CSS property, `var()` will not resolve. In that case import `currentTheme` and use `currentTheme().tokens.fgFaint`. Check the call site when implementing.

- [ ] **Step 3: Update any `PROFILE_PALETTE` importers**

```bash
grep -rn "PROFILE_PALETTE" web/src web/tests
```

Replace each import with `profilePalette()`. Update `web/tests/charts.test.tsx` if it asserts on the constant.

- [ ] **Step 4: Run tests**

Run: `cd web && bun run test -- charts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/ web/tests/charts.test.tsx
git commit -m "feat(charts): read series colors from the active theme"
```

---

At this point every rendering surface follows the theme, but only Forest Dark exists. Phase 4 adds the catalog.

---

## Phase 4 — Theme catalog (Tasks 12–14)

Ends with: all 16 themes selectable and validated.

### Task 12: Catppuccin's four flavors + the theme test harness

**Files:**
- Create: `web/src/lib/themes/catppuccin.ts`, `web/tests/helpers/contrast.ts`, `web/tests/theme-catalog.test.ts`
- Modify: `web/src/lib/themes/index.ts`

- [ ] **Step 1: Write the contrast helper**

Not a test file — `web/tests/helpers/` sits outside Vitest's `*.test.ts` glob, so it will not be collected as a suite.

```ts
// web/tests/helpers/contrast.ts
// WCAG 2.1 relative luminance and contrast ratio.

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 2: Write the failing catalog test**

Note the two-tier contrast rule from the spec amendment at the top of this plan: hard floors only on the pairs our mapping controls, plus a gross-error floor of 2.0 on published role hues with the real numbers printed.

```ts
// web/tests/theme-catalog.test.ts
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
```

- [ ] **Step 3: Run test to verify the harness works**

Run: `cd web && bun run test -- theme-catalog`
Expected: PASS with only Forest Dark in the registry. Confirm Forest Dark clears every hard floor before adding more themes — if it does not, the helper is wrong, not the theme.

- [ ] **Step 4: Write the Catppuccin family**

All four flavors share one file because they share a palette structure. Hex values are transcribed from the Catppuccin style guide.

```ts
// web/src/lib/themes/catppuccin.ts
import { buildTheme } from "./build";

export const catppuccinLatte = buildTheme({
  id: "catppuccin-latte", name: "Latte", family: "Catppuccin", scheme: "light",
  bg: "#eff1f5", bg2: "#e6e9ef", bg3: "#ccd0da",
  fg: "#4c4f69", fgDim: "#6c6f85", fgFaint: "#9ca0b0",
  border: "#ccd0da", borderStrong: "#bcc0cc",
  accent: "#8839ef", accentFg: "#eff1f5",
  ok: "#40a02b", warn: "#df8e1d", error: "#d20f39", info: "#1e66f5",
  purple: "#8839ef", green: "#40a02b", orange: "#fe640b", blue: "#1e66f5",
  cyan: "#04a5e5", yellow: "#df8e1d", red: "#d20f39", pink: "#ea76cb",
  teal: "#179299", comment: "#8c8fa1",
});

export const catppuccinFrappe = buildTheme({
  id: "catppuccin-frappe", name: "Frappé", family: "Catppuccin", scheme: "dark",
  bg: "#303446", bg2: "#292c3c", bg3: "#414559",
  fg: "#c6d0f5", fgDim: "#a5adce", fgFaint: "#737994",
  border: "#414559", borderStrong: "#51576d",
  accent: "#ca9ee6", accentFg: "#232634",
  ok: "#a6d189", warn: "#e5c890", error: "#e78284", info: "#8caaee",
  purple: "#ca9ee6", green: "#a6d189", orange: "#ef9f76", blue: "#8caaee",
  cyan: "#99d1db", yellow: "#e5c890", red: "#e78284", pink: "#f4b8e4",
  teal: "#81c8be", comment: "#838ba7",
});

export const catppuccinMacchiato = buildTheme({
  id: "catppuccin-macchiato", name: "Macchiato", family: "Catppuccin", scheme: "dark",
  bg: "#24273a", bg2: "#1e2030", bg3: "#363a4f",
  fg: "#cad3f5", fgDim: "#a5adcb", fgFaint: "#6e738d",
  border: "#363a4f", borderStrong: "#494d64",
  accent: "#c6a0f6", accentFg: "#181926",
  ok: "#a6da95", warn: "#eed49f", error: "#ed8796", info: "#8aadf4",
  purple: "#c6a0f6", green: "#a6da95", orange: "#f5a97f", blue: "#8aadf4",
  cyan: "#91d7e3", yellow: "#eed49f", red: "#ed8796", pink: "#f5bde6",
  teal: "#8bd5ca", comment: "#8087a2",
});

export const catppuccinMocha = buildTheme({
  id: "catppuccin-mocha", name: "Mocha", family: "Catppuccin", scheme: "dark",
  bg: "#1e1e2e", bg2: "#181825", bg3: "#313244",
  fg: "#cdd6f4", fgDim: "#a6adc8", fgFaint: "#6c7086",
  border: "#313244", borderStrong: "#45475a",
  accent: "#cba6f7", accentFg: "#11111b",
  ok: "#a6e3a1", warn: "#f9e2af", error: "#f38ba8", info: "#89b4fa",
  purple: "#cba6f7", green: "#a6e3a1", orange: "#fab387", blue: "#89b4fa",
  cyan: "#89dceb", yellow: "#f9e2af", red: "#f38ba8", pink: "#f5c2e7",
  teal: "#94e2d5", comment: "#7f849c",
});
```

- [ ] **Step 5: Register them**

In `web/src/lib/themes/index.ts`:

```ts
import { forestDark } from "./forest-dark";
import {
  catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha,
} from "./catppuccin";

export const THEMES: Theme[] = [
  forestDark,
  catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha,
];
```

- [ ] **Step 6: Run tests**

Run: `cd web && bun run test -- theme-catalog`
Expected: PASS. The printed table should show Latte's `warn` near 2.31 and `ok` near 2.96 — both above the 2.0 gross-error floor, exactly as the spec amendment predicts.

- [ ] **Step 7: Verify Mocha by hand**

Run `bun run dev:web`. In the browser console: `localStorage.setItem("forest.theme", '"catppuccin-mocha"')`, then reload. Check the dashboard, a terminal, a diff (**added lines must be green, not purple** — this is what the `--ok` split exists for), and the file editor.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/themes/catppuccin.ts web/src/lib/themes/index.ts \
        web/tests/theme-catalog.test.ts web/tests/helpers/contrast.ts
git commit -m "feat(themes): Catppuccin flavors and the catalog test harness"
```

---

### Task 13: The remaining nine families

**Files:**
- Create: `web/src/lib/themes/{rose-pine,gruvbox,one,solarized,dracula,nord,tokyo-night}.ts`
- Modify: `web/src/lib/themes/index.ts`

Every family lands with the same shape, and the catalog test from Task 12 validates each one automatically as it is added.

- [ ] **Step 1: Rosé Pine**

Rosé Pine publishes six hues — two short of the eight distinct chart colors the test requires — so `subtle` and `muted` fill the last two slots.

```ts
// web/src/lib/themes/rose-pine.ts
import { buildTheme } from "./build";

export const rosePine = buildTheme({
  id: "rose-pine", name: "Rosé Pine", family: "Rosé Pine", scheme: "dark",
  bg: "#191724", bg2: "#1f1d2e", bg3: "#26233a",
  fg: "#e0def4", fgDim: "#908caa", fgFaint: "#6e6a86",
  border: "#26233a", borderStrong: "#403d52",
  accent: "#c4a7e7", accentFg: "#191724",
  ok: "#9ccfd8", warn: "#f6c177", error: "#eb6f92", info: "#31748f",
  purple: "#c4a7e7", green: "#9ccfd8", orange: "#f6c177", blue: "#31748f",
  cyan: "#9ccfd8", yellow: "#f6c177", red: "#eb6f92", pink: "#ebbcba",
  teal: "#31748f", comment: "#6e6a86",
  overrides: {
    chart1: "#31748f", chart2: "#eb6f92", chart3: "#9ccfd8", chart4: "#f6c177",
    chart5: "#c4a7e7", chart6: "#ebbcba", chart7: "#908caa", chart8: "#6e6a86",
  },
});

export const rosePineDawn = buildTheme({
  id: "rose-pine-dawn", name: "Dawn", family: "Rosé Pine", scheme: "light",
  bg: "#faf4ed", bg2: "#fffaf3", bg3: "#f2e9e1",
  fg: "#575279", fgDim: "#797593", fgFaint: "#9893a5",
  border: "#dfdad9", borderStrong: "#cecacd",
  accent: "#907aa9", accentFg: "#faf4ed",
  ok: "#56949f", warn: "#ea9d34", error: "#b4637a", info: "#286983",
  purple: "#907aa9", green: "#56949f", orange: "#ea9d34", blue: "#286983",
  cyan: "#56949f", yellow: "#ea9d34", red: "#b4637a", pink: "#d7827e",
  teal: "#286983", comment: "#9893a5",
  overrides: {
    chart1: "#286983", chart2: "#b4637a", chart3: "#56949f", chart4: "#ea9d34",
    chart5: "#907aa9", chart6: "#d7827e", chart7: "#797593", chart8: "#9893a5",
  },
});
```

- [ ] **Step 2: Gruvbox**

```ts
// web/src/lib/themes/gruvbox.ts
import { buildTheme } from "./build";

export const gruvboxDark = buildTheme({
  id: "gruvbox-dark", name: "Gruvbox Dark", family: "Gruvbox", scheme: "dark",
  bg: "#282828", bg2: "#1d2021", bg3: "#3c3836",
  fg: "#ebdbb2", fgDim: "#bdae93", fgFaint: "#928374",
  border: "#3c3836", borderStrong: "#504945",
  accent: "#83a598", accentFg: "#1d2021",
  ok: "#b8bb26", warn: "#fabd2f", error: "#fb4934", info: "#83a598",
  purple: "#d3869b", green: "#b8bb26", orange: "#fe8019", blue: "#83a598",
  cyan: "#8ec07c", yellow: "#fabd2f", red: "#fb4934", pink: "#d3869b",
  teal: "#8ec07c", comment: "#928374",
  overrides: {
    chart1: "#83a598", chart2: "#d3869b", chart3: "#b8bb26", chart4: "#fabd2f",
    chart5: "#8ec07c", chart6: "#fe8019", chart7: "#fb4934", chart8: "#928374",
  },
});

export const gruvboxLight = buildTheme({
  id: "gruvbox-light", name: "Gruvbox Light", family: "Gruvbox", scheme: "light",
  bg: "#fbf1c7", bg2: "#f9f5d7", bg3: "#ebdbb2",
  fg: "#3c3836", fgDim: "#665c54", fgFaint: "#928374",
  border: "#ebdbb2", borderStrong: "#d5c4a1",
  accent: "#076678", accentFg: "#fbf1c7",
  ok: "#79740e", warn: "#b57614", error: "#9d0006", info: "#076678",
  purple: "#8f3f71", green: "#79740e", orange: "#af3a03", blue: "#076678",
  cyan: "#427b58", yellow: "#b57614", red: "#9d0006", pink: "#8f3f71",
  teal: "#427b58", comment: "#928374",
  overrides: {
    chart1: "#076678", chart2: "#8f3f71", chart3: "#79740e", chart4: "#b57614",
    chart5: "#427b58", chart6: "#af3a03", chart7: "#9d0006", chart8: "#7c6f64",
  },
});
```

- [ ] **Step 3: One Dark / One Light**

Atom One publishes no mid-tone text color, so `fgDim` is derived by mixing `fg` 35% toward `bg` and written out literally, per the spec's recipe.

```ts
// web/src/lib/themes/one.ts
import { buildTheme } from "./build";

export const oneDark = buildTheme({
  id: "one-dark", name: "One Dark", family: "One", scheme: "dark",
  bg: "#282c34", bg2: "#21252b", bg3: "#3e4451",
  fg: "#abb2bf", fgDim: "#828997", fgFaint: "#5c6370",
  border: "#3e4451", borderStrong: "#4b5263",
  accent: "#c678dd", accentFg: "#21252b",
  ok: "#98c379", warn: "#e5c07b", error: "#e06c75", info: "#61afef",
  purple: "#c678dd", green: "#98c379", orange: "#d19a66", blue: "#61afef",
  cyan: "#56b6c2", yellow: "#e5c07b", red: "#e06c75", pink: "#c678dd",
  teal: "#56b6c2", comment: "#5c6370",
  overrides: {
    chart1: "#61afef", chart2: "#c678dd", chart3: "#98c379", chart4: "#e5c07b",
    chart5: "#56b6c2", chart6: "#d19a66", chart7: "#e06c75", chart8: "#828997",
  },
});

export const oneLight = buildTheme({
  id: "one-light", name: "One Light", family: "One", scheme: "light",
  bg: "#fafafa", bg2: "#f0f0f1", bg3: "#e5e5e6",
  fg: "#383a42", fgDim: "#696c77", fgFaint: "#a0a1a7",
  border: "#e5e5e6", borderStrong: "#d4d4d5",
  accent: "#a626a4", accentFg: "#fafafa",
  ok: "#50a14f", warn: "#c18401", error: "#e45649", info: "#4078f2",
  purple: "#a626a4", green: "#50a14f", orange: "#986801", blue: "#4078f2",
  cyan: "#0184bc", yellow: "#c18401", red: "#e45649", pink: "#a626a4",
  teal: "#0184bc", comment: "#a0a1a7",
  overrides: {
    chart1: "#4078f2", chart2: "#a626a4", chart3: "#50a14f", chart4: "#c18401",
    chart5: "#0184bc", chart6: "#986801", chart7: "#e45649", chart8: "#696c77",
  },
});
```

- [ ] **Step 4: Solarized**

Solarized inverts the usual convention — `base0` is body text and `base1` is *emphasized*. Mapping them literally would make secondary text brighter than primary, so `fg` takes the emphasized tone and `fgDim` the body tone. Solarized also publishes only two background tones per mode, so `bg2` and `bg3` coincide.

```ts
// web/src/lib/themes/solarized.ts
import { buildTheme } from "./build";

// Solarized's eight accents are shared verbatim between the light and dark
// modes — that is the point of the palette.
const A = {
  yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682",
  violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900",
} as const;

export const solarizedDark = buildTheme({
  id: "solarized-dark", name: "Solarized Dark", family: "Solarized", scheme: "dark",
  bg: "#002b36", bg2: "#073642", bg3: "#073642",
  fg: "#93a1a1", fgDim: "#839496", fgFaint: "#586e75",
  border: "#073642", borderStrong: "#586e75",
  accent: A.blue, accentFg: "#002b36",
  ok: A.green, warn: A.yellow, error: A.red, info: A.blue,
  purple: A.violet, green: A.green, orange: A.orange, blue: A.blue,
  cyan: A.cyan, yellow: A.yellow, red: A.red, pink: A.magenta,
  teal: A.cyan, comment: "#586e75",
  overrides: {
    chart1: A.blue, chart2: A.magenta, chart3: A.green, chart4: A.yellow,
    chart5: A.violet, chart6: A.cyan, chart7: A.orange, chart8: A.red,
  },
});

export const solarizedLight = buildTheme({
  id: "solarized-light", name: "Solarized Light", family: "Solarized", scheme: "light",
  bg: "#fdf6e3", bg2: "#eee8d5", bg3: "#eee8d5",
  fg: "#586e75", fgDim: "#657b83", fgFaint: "#93a1a1",
  border: "#eee8d5", borderStrong: "#93a1a1",
  accent: A.blue, accentFg: "#fdf6e3",
  ok: A.green, warn: A.yellow, error: A.red, info: A.blue,
  purple: A.violet, green: A.green, orange: A.orange, blue: A.blue,
  cyan: A.cyan, yellow: A.yellow, red: A.red, pink: A.magenta,
  teal: A.cyan, comment: "#93a1a1",
  overrides: {
    chart1: A.blue, chart2: A.magenta, chart3: A.green, chart4: A.yellow,
    chart5: A.violet, chart6: A.cyan, chart7: A.orange, chart8: A.red,
  },
});
```

- [ ] **Step 5: Dracula**

```ts
// web/src/lib/themes/dracula.ts
import { buildTheme } from "./build";

// Dracula's comment colour #6272a4 reaches only ~2.8:1 on its background, so it
// serves as fgFaint rather than fgDim. fgDim is derived: mix(fg, bg, 35%).
export const dracula = buildTheme({
  id: "dracula", name: "Dracula", family: "Dracula", scheme: "dark",
  bg: "#282a36", bg2: "#21222c", bg3: "#343746",
  fg: "#f8f8f2", fgDim: "#afb0b0", fgFaint: "#6272a4",
  border: "#44475a", borderStrong: "#6272a4",
  accent: "#bd93f9", accentFg: "#21222c",
  ok: "#50fa7b", warn: "#f1fa8c", error: "#ff5555", info: "#8be9fd",
  purple: "#bd93f9", green: "#50fa7b", orange: "#ffb86c", blue: "#8be9fd",
  cyan: "#8be9fd", yellow: "#f1fa8c", red: "#ff5555", pink: "#ff79c6",
  teal: "#50fa7b", comment: "#6272a4",
  overrides: {
    chart1: "#8be9fd", chart2: "#ff79c6", chart3: "#50fa7b", chart4: "#f1fa8c",
    chart5: "#bd93f9", chart6: "#ffb86c", chart7: "#ff5555", chart8: "#6272a4",
  },
});
```

- [ ] **Step 6: Nord**

```ts
// web/src/lib/themes/nord.ts
import { buildTheme } from "./build";

export const nord = buildTheme({
  id: "nord", name: "Nord", family: "Nord", scheme: "dark",
  bg: "#2e3440", bg2: "#3b4252", bg3: "#434c5e",
  fg: "#eceff4", fgDim: "#d8dee9", fgFaint: "#616e88",
  border: "#434c5e", borderStrong: "#4c566a",
  accent: "#88c0d0", accentFg: "#2e3440",
  ok: "#a3be8c", warn: "#ebcb8b", error: "#bf616a", info: "#81a1c1",
  purple: "#b48ead", green: "#a3be8c", orange: "#d08770", blue: "#81a1c1",
  cyan: "#88c0d0", yellow: "#ebcb8b", red: "#bf616a", pink: "#b48ead",
  teal: "#8fbcbb", comment: "#616e88",
  overrides: {
    chart1: "#81a1c1", chart2: "#b48ead", chart3: "#a3be8c", chart4: "#ebcb8b",
    chart5: "#88c0d0", chart6: "#d08770", chart7: "#bf616a", chart8: "#8fbcbb",
  },
});
```

- [ ] **Step 7: Tokyo Night**

```ts
// web/src/lib/themes/tokyo-night.ts
import { buildTheme } from "./build";

export const tokyoNight = buildTheme({
  id: "tokyo-night", name: "Tokyo Night", family: "Tokyo Night", scheme: "dark",
  bg: "#1a1b26", bg2: "#16161e", bg3: "#292e42",
  fg: "#c0caf5", fgDim: "#a9b1d6", fgFaint: "#565f89",
  border: "#292e42", borderStrong: "#3b4261",
  accent: "#bb9af7", accentFg: "#16161e",
  ok: "#9ece6a", warn: "#e0af68", error: "#f7768e", info: "#7aa2f7",
  purple: "#bb9af7", green: "#9ece6a", orange: "#ff9e64", blue: "#7aa2f7",
  cyan: "#7dcfff", yellow: "#e0af68", red: "#f7768e", pink: "#bb9af7",
  teal: "#1abc9c", comment: "#565f89",
  overrides: {
    chart1: "#7aa2f7", chart2: "#bb9af7", chart3: "#9ece6a", chart4: "#e0af68",
    chart5: "#7dcfff", chart6: "#ff9e64", chart7: "#f7768e", chart8: "#1abc9c",
  },
});
```

- [ ] **Step 8: Register all 16 in picker order**

```ts
// web/src/lib/themes/index.ts — replace the imports and THEMES array
import { forestDark } from "./forest-dark";
import { catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha } from "./catppuccin";
import { rosePine, rosePineDawn } from "./rose-pine";
import { gruvboxDark, gruvboxLight } from "./gruvbox";
import { oneDark, oneLight } from "./one";
import { solarizedDark, solarizedLight } from "./solarized";
import { dracula } from "./dracula";
import { nord } from "./nord";
import { tokyoNight } from "./tokyo-night";

export const THEMES: Theme[] = [
  forestDark,
  catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha,
  rosePine, rosePineDawn,
  gruvboxDark, gruvboxLight,
  oneDark, oneLight,
  solarizedDark, solarizedLight,
  dracula, nord, tokyoNight,
];
```

- [ ] **Step 9: Run the catalog tests**

Run: `cd web && bun run test -- theme-catalog`
Expected: PASS for all 16.

If a **hard** floor fails, fix the *mapping*, not the floor — choose a different published tone for `fg` / `fgDim` / `accentFg`. Read the printed contrast table before changing any value.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/themes/
git commit -m "feat(themes): add the remaining nine theme families"
```

---

### Task 14: Sweep the light themes across every route

Light themes are where hardcoded assumptions surface. No code in this task — it is where Phase 2 misses get caught, and skipping it means shipping a broken Latte.

- [ ] **Step 1: Switch to Catppuccin Latte**

Run `bun run dev:web`, then in the browser console:

```js
localStorage.setItem("forest.theme", '"catppuccin-latte"'); location.reload()
```

- [ ] **Step 2: Walk every route**

Look for white-on-white text, invisible borders, and stray dark backgrounds:

- `/` — project cards, git badges, service chips, port chips, group tags
- `/projects/:id` — tab strip, terminal (background must be Latte's `#eff1f5`, **not** `#0e0e10`), file tree, editor, image viewer + zoom controls, diff view, git panel, info pane, processes, containers
- `/sessions` — session list, search field, charts, token meter
- `/archives`
- `/settings` — still the old layout at this point; check it is legible, not that it is pretty
- `/m` — session list, a session detail, the new-run form
- A markdown file containing a mermaid diagram — the diagram must be legible on a light background
- The new-project modal and the launcher fly-out menu

- [ ] **Step 3: Fix anything found**

Each fix is a literal color that escaped Task 6. Afterwards re-run the Task 6 Step 2 grep to confirm nothing else is hiding.

- [ ] **Step 4: Spot-check two more**

Repeat quickly for `solarized-light` (unusual cream background) and `gruvbox-light` (warm background) — the two most likely to expose a hardcoded neutral that Latte happened to tolerate.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A web/src
git commit -m "fix(css): correct colors that only broke under light themes"
```

---

## Phase 5 — Settings restructure (Tasks 15–21)

Ends with: a sidebar settings page with per-section save, an unsaved-changes guard, a theme picker, and a mobile theme sheet.

**No server changes.** `PATCH /api/config` already guards every field with a `typeof` check (`server/src/routes/config.ts:50-66`), so partial bodies work today.

### Task 15: Config context, settings shell, and routing

**Files:**
- Create: `web/src/lib/settings-config.ts`
- Rewrite: `web/src/pages/Settings.tsx`
- Modify: `web/src/main.tsx`
- Test: `web/tests/Settings.shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/Settings.shell.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Router, Route, Navigate } from "@solidjs/router";
import Settings from "../src/pages/Settings";

vi.mock("../src/api", () => ({
  fetchConfig: vi.fn(async () => ({
    scanRoot: "/tmp/projects", pollIntervalMs: 10_000,
    sessionMaxTotal: 32, sessionMaxScrollbackLines: 10_000,
    sessionDefaultShell: "/bin/zsh", projectSubdirs: [], launchers: [],
    claudeConfigDirs: [],
  })),
  patchConfig: vi.fn(async () => ({ ok: true })),
  runDiscover: vi.fn(async () => ({ count: 0, root: "/tmp/projects" })),
}));

vi.mock("../src/projects-context", () => ({
  useProjects: () => ({ projects: () => [], refetch: vi.fn() }),
}));

function renderAt(path: string) {
  return render(() => (
    <Router url={path}>
      <Route path="/settings" component={Settings}>
        <Route path="/" component={() => <Navigate href="/settings/appearance" />} />
        <Route path="/appearance" component={() => <div>appearance-pane</div>} />
        <Route path="/scan" component={() => <div>scan-pane</div>} />
      </Route>
    </Router>
  ));
}

beforeEach(() => localStorage.clear());

describe("settings shell", () => {
  test("renders the rail with every section", async () => {
    renderAt("/settings/appearance");
    for (const label of [
      "appearance", "dashboard", "scan", "terminals", "launchers", "integrations", "system",
    ]) {
      expect(await screen.findByRole("link", { name: label })).toBeTruthy();
    }
  });

  test("renders the routed section in the pane", async () => {
    renderAt("/settings/scan");
    expect(await screen.findByText("scan-pane")).toBeTruthy();
  });

  test("bare /settings redirects to appearance", async () => {
    renderAt("/settings");
    expect(await screen.findByText("appearance-pane")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- Settings.shell`
Expected: FAIL — Settings still renders the old single form, so no rail links exist.

- [ ] **Step 3: Write the config context**

Fetching once in the shell avoids seven sections each issuing their own request, and mirrors how `ProjectsContext` already works.

```ts
// web/src/lib/settings-config.ts
import { createContext, useContext, type Resource } from "solid-js";

export type LauncherEntry = {
  id: string;
  label: string;
  command: string | null;
  args: string[];
  agent?: string;
};

export type ServerConfig = {
  scanRoot: string | null;
  pollIntervalMs: number;
  sessionMaxTotal?: number;
  sessionMaxScrollbackLines?: number;
  sessionDefaultShell?: string;
  projectSubdirs?: string[];
  launchers?: LauncherEntry[];
  claudeConfigDirs?: Array<{ path: string; profile: string }>;
};

export type SettingsConfig = {
  config: Resource<ServerConfig>;
  refetch: () => void;
};

export const SettingsConfigContext = createContext<SettingsConfig>();

export function useSettingsConfig(): SettingsConfig {
  const ctx = useContext(SettingsConfigContext);
  if (!ctx) throw new Error("useSettingsConfig used outside SettingsConfigContext");
  return ctx;
}
```

- [ ] **Step 4: Rewrite the Settings shell**

The old 304-line file becomes a shell. Its whole job is the rail, the config resource, and the outlet.

```tsx
// web/src/pages/Settings.tsx
import { createResource } from "solid-js";
import { A, type RouteSectionProps } from "@solidjs/router";
import { fetchConfig } from "../api";
import { SettingsConfigContext, type ServerConfig } from "../lib/settings-config";

const SECTIONS = [
  { path: "appearance", label: "appearance" },
  { path: "dashboard", label: "dashboard" },
  { path: "scan", label: "scan" },
  { path: "terminals", label: "terminals" },
  { path: "launchers", label: "launchers" },
  { path: "integrations", label: "integrations" },
  { path: "system", label: "system" },
] as const;

export default function Settings(props: RouteSectionProps) {
  const [config, { refetch }] = createResource<ServerConfig>(fetchConfig);

  return (
    <div class="settings page">
      <h2>settings</h2>
      <SettingsConfigContext.Provider value={{ config, refetch }}>
        <div class="settings-shell">
          <nav class="settings-rail">
            {SECTIONS.map((s) => (
              <A href={`/settings/${s.path}`} activeClass="active">{s.label}</A>
            ))}
          </nav>
          <div class="settings-pane">{props.children}</div>
        </div>
      </SettingsConfigContext.Provider>
    </div>
  );
}
```

- [ ] **Step 5: Register the child routes**

In `web/src/main.tsx`, replace the single settings route. Import `Navigate` from `@solidjs/router` and the seven section components (created in Tasks 17–18).

```tsx
      <Route path="/settings" component={Settings}>
        <Route path="/" component={() => <Navigate href="/settings/appearance" />} />
        <Route path="/appearance" component={AppearanceSection} />
        <Route path="/dashboard" component={DashboardSection} />
        <Route path="/scan" component={ScanSection} />
        <Route path="/terminals" component={TerminalsSection} />
        <Route path="/launchers" component={LaunchersSection} />
        <Route path="/integrations" component={IntegrationsSection} />
        <Route path="/system" component={SystemSection} />
      </Route>
```

> Order of work: create the seven section files as one-line stubs first so `main.tsx` compiles, then fill each in during Tasks 17–18. A stub is `export default function X() { return null; }`.

- [ ] **Step 6: Run tests**

Run: `cd web && bun run test -- Settings.shell`
Expected: PASS, 3 tests

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/settings-config.ts web/src/pages/Settings.tsx \
        web/src/main.tsx web/src/components/settings/ web/tests/Settings.shell.test.tsx
git commit -m "feat(settings): sidebar shell with routed sections"
```

---

### Task 16: The unsaved-changes guard

**Files:**
- Create: `web/src/lib/settings-dirty.ts`, `web/src/components/settings/UnsavedDialog.tsx`
- Test: `web/tests/settings-dirty.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/settings-dirty.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route, A } from "@solidjs/router";
import { createSignal } from "solid-js";
import { useUnsavedGuard } from "../src/lib/settings-dirty";
import UnsavedDialog from "../src/components/settings/UnsavedDialog";

function Section(props: { save: () => Promise<void>; reset: () => void }) {
  const [value, setValue] = createSignal("original");
  const [baseline, setBaseline] = createSignal("original");
  const guard = useUnsavedGuard(
    () => value() !== baseline(),
    async () => { await props.save(); setBaseline(value()); },
    () => { props.reset(); setValue(baseline()); },
  );
  return (
    <div>
      <input aria-label="field" value={value()} oninput={(e) => setValue(e.currentTarget.value)} />
      <A href="/other">leave</A>
      <UnsavedDialog guard={guard} />
    </div>
  );
}

function setup(save = vi.fn(async () => {}), reset = vi.fn()) {
  render(() => (
    <Router url="/section">
      <Route path="/section" component={() => <Section save={save} reset={reset} />} />
      <Route path="/other" component={() => <div>elsewhere</div>} />
    </Router>
  ));
  return { save, reset };
}

const dirtyThenLeave = async () => {
  fireEvent.input(screen.getByLabelText("field"), { target: { value: "changed" } });
  fireEvent.click(screen.getByText("leave"));
};

describe("useUnsavedGuard", () => {
  test("a clean section navigates with no dialog", async () => {
    setup();
    fireEvent.click(screen.getByText("leave"));
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("a dirty section is blocked and prompts", async () => {
    setup();
    await dirtyThenLeave();
    expect(await screen.findByText(/unsaved changes/i)).toBeTruthy();
    expect(screen.queryByText("elsewhere")).toBeNull();
  });

  test("save and continue persists then navigates", async () => {
    const { save } = setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByText(/save/i));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("discard resets then navigates without saving", async () => {
    const { save, reset } = setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByText(/discard/i));
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("cancel stays put with the edit intact", async () => {
    setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByText(/cancel/i));
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull());
    expect(screen.queryByText("elsewhere")).toBeNull();
    expect((screen.getByLabelText("field") as HTMLInputElement).value).toBe("changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- settings-dirty`
Expected: FAIL — cannot resolve `../src/lib/settings-dirty`

- [ ] **Step 3: Write the guard primitive**

```ts
// web/src/lib/settings-dirty.ts
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { useBeforeLeave, type BeforeLeaveEventArgs } from "@solidjs/router";

export type UnsavedGuard = {
  /** true while a navigation is blocked awaiting the user's decision */
  pending: Accessor<boolean>;
  saveAndContinue: () => Promise<void>;
  discardAndContinue: () => void;
  stay: () => void;
};

/**
 * Blocks in-app navigation away from a section with unsaved edits, and warns on
 * tab close. `save` must update the section's baseline so the section is clean
 * afterwards; `reset` must restore fields to the last-loaded values.
 *
 * Only one section is mounted at a time, so there is no cross-section dirty
 * state to reconcile.
 */
export function useUnsavedGuard(
  dirty: Accessor<boolean>,
  save: () => Promise<void>,
  reset: () => void,
): UnsavedGuard {
  const [blocked, setBlocked] = createSignal<BeforeLeaveEventArgs | null>(null);

  useBeforeLeave((e) => {
    // defaultPrevented means another handler already blocked this navigation.
    if (!dirty() || e.defaultPrevented) return;
    e.preventDefault();
    setBlocked(e);
  });

  // Router navigation is only half the story — tab close and reload bypass it
  // entirely. The browser shows its own generic prompt; it cannot be
  // customized, but it is the difference between losing edits and not.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!dirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));

  // force=true skips re-running the leave handlers, which would otherwise
  // re-open the dialog on the retried navigation.
  const proceed = (e: BeforeLeaveEventArgs) => {
    setBlocked(null);
    e.retry(true);
  };

  return {
    pending: () => blocked() !== null,
    saveAndContinue: async () => {
      const e = blocked();
      if (!e) return;
      await save();
      proceed(e);
    },
    discardAndContinue: () => {
      const e = blocked();
      if (!e) return;
      reset();
      proceed(e);
    },
    stay: () => setBlocked(null),
  };
}
```

- [ ] **Step 4: Write the dialog**

```tsx
// web/src/components/settings/UnsavedDialog.tsx
import { Show, createSignal } from "solid-js";
import type { UnsavedGuard } from "../../lib/settings-dirty";

export default function UnsavedDialog(props: { guard: UnsavedGuard }) {
  const [saving, setSaving] = createSignal(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await props.guard.saveAndContinue();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Show when={props.guard.pending()}>
      <div class="modal-backdrop">
        <div class="guard-dialog" role="dialog" aria-modal="true" aria-label="unsaved changes">
          <div class="guard-dialog-body">
            <p>You have unsaved changes in this section.</p>
            <div class="guard-dialog-actions">
              <button type="button" onclick={() => props.guard.stay()}>cancel</button>
              <button type="button" class="danger" onclick={() => props.guard.discardAndContinue()}>
                discard
              </button>
              <button type="button" class="primary" disabled={saving()} onclick={onSave}>
                {saving() ? "saving…" : "save & continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd web && bun run test -- settings-dirty`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/settings-dirty.ts web/src/components/settings/UnsavedDialog.tsx \
        web/tests/settings-dirty.test.tsx
git commit -m "feat(settings): unsaved-changes guard with save/discard/cancel"
```

---

### Task 17: Scan and Terminals sections

Establishes the pattern every explicit section follows: a `baseline` signal holding the last-loaded values, working signals for the fields, `dirty()` comparing the two, and `save()` moving the baseline forward.

**Files:**
- Create: `web/src/components/settings/ScanSection.tsx`, `web/src/components/settings/TerminalsSection.tsx`
- Test: `web/tests/Settings.sections.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/Settings.sections.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { createResource } from "solid-js";
import { SettingsConfigContext, type ServerConfig } from "../src/lib/settings-config";
import ScanSection from "../src/components/settings/ScanSection";
import TerminalsSection from "../src/components/settings/TerminalsSection";
import { patchConfig, runDiscover } from "../src/api";

const CONFIG: ServerConfig = {
  scanRoot: "/tmp/projects", pollIntervalMs: 10_000,
  sessionMaxTotal: 32, sessionMaxScrollbackLines: 10_000,
  sessionDefaultShell: "/bin/zsh", projectSubdirs: ["Personal"], launchers: [],
  claudeConfigDirs: [],
};

vi.mock("../src/api", () => ({
  fetchConfig: vi.fn(async () => CONFIG),
  patchConfig: vi.fn(async () => ({ ok: true })),
  runDiscover: vi.fn(async () => ({ count: 3, root: "/tmp/projects" })),
}));

const refetchProjects = vi.fn();
vi.mock("../src/projects-context", () => ({
  useProjects: () => ({ projects: () => [], refetch: refetchProjects }),
}));

function renderSection(Section: () => unknown) {
  const [config, { refetch }] = createResource(async () => CONFIG);
  return render(() => (
    <Router url="/settings/x">
      <Route
        path="/settings/x"
        component={() => (
          <SettingsConfigContext.Provider value={{ config, refetch }}>
            <Section />
          </SettingsConfigContext.Provider>
        )}
      />
    </Router>
  ));
}

beforeEach(() => vi.clearAllMocks());

describe("ScanSection", () => {
  test("saves only its own fields and runs discover", async () => {
    renderSection(ScanSection);
    const root = await screen.findByLabelText("scan root");
    fireEvent.input(root, { target: { value: "/tmp/other" } });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      scanRoot: "/tmp/other",
      pollIntervalMs: 10_000,
      projectSubdirs: ["Personal"],
    });
    await waitFor(() => expect(runDiscover).toHaveBeenCalledOnce());
    expect(refetchProjects).toHaveBeenCalled();
  });

  test("does not navigate away after saving", async () => {
    renderSection(ScanSection);
    fireEvent.click(await screen.findByText("save"));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeTruthy());
    expect(screen.getByLabelText("scan root")).toBeTruthy();
  });
});

describe("TerminalsSection", () => {
  test("saves only terminal fields and does not run discover", async () => {
    renderSection(TerminalsSection);
    const shell = await screen.findByLabelText("default shell");
    fireEvent.input(shell, { target: { value: "/bin/fish" } });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      sessionMaxTotal: 32,
      sessionMaxScrollbackLines: 10_000,
      sessionDefaultShell: "/bin/fish",
    });
    expect(runDiscover).not.toHaveBeenCalled();
  });

  test("save is disabled until something changes", async () => {
    renderSection(TerminalsSection);
    const save = await screen.findByText("save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("default shell"), { target: { value: "/bin/fish" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- Settings.sections`
Expected: FAIL — the section modules are still the stubs from Task 15, returning `null`.

- [ ] **Step 3: Write ScanSection**

```tsx
// web/src/components/settings/ScanSection.tsx
import { createEffect, createSignal, For, Show } from "solid-js";
import { patchConfig, runDiscover } from "../../api";
import { useProjects } from "../../projects-context";
import { useSettingsConfig } from "../../lib/settings-config";
import { useUnsavedGuard } from "../../lib/settings-dirty";
import UnsavedDialog from "./UnsavedDialog";

type Values = { scanRoot: string; pollMs: number; subdirs: string[] };

export default function ScanSection() {
  const { config } = useSettingsConfig();
  const { refetch: refetchProjects } = useProjects();

  const [baseline, setBaseline] = createSignal<Values | null>(null);
  const [scanRoot, setScanRoot] = createSignal("");
  const [pollMs, setPollMs] = createSignal(10_000);
  const [subdirs, setSubdirs] = createSignal<string[]>([]);
  const [newSubdir, setNewSubdir] = createSignal("");
  const [subdirError, setSubdirError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Seed from the server config once it arrives and record it as the baseline,
  // so dirty() starts false.
  createEffect(() => {
    const c = config();
    if (!c || baseline()) return;
    const v: Values = {
      scanRoot: c.scanRoot ?? "",
      pollMs: c.pollIntervalMs,
      subdirs: c.projectSubdirs ?? [],
    };
    setScanRoot(v.scanRoot);
    setPollMs(v.pollMs);
    setSubdirs(v.subdirs);
    setBaseline(v);
  });

  const current = (): Values => ({ scanRoot: scanRoot(), pollMs: pollMs(), subdirs: subdirs() });

  const dirty = () => {
    const b = baseline();
    if (!b) return false;
    const c = current();
    return (
      b.scanRoot !== c.scanRoot ||
      b.pollMs !== c.pollMs ||
      b.subdirs.join(" ") !== c.subdirs.join(" ")
    );
  };

  const reset = () => {
    const b = baseline();
    if (!b) return;
    setScanRoot(b.scanRoot);
    setPollMs(b.pollMs);
    setSubdirs(b.subdirs);
    setSubdirError(null);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const v = current();
      // Only this section's fields. PATCH /api/config ignores absent keys.
      await patchConfig({
        scanRoot: v.scanRoot,
        pollIntervalMs: v.pollMs,
        projectSubdirs: v.subdirs,
      });
      // Scan is the only section that changes what gets discovered.
      const result = await runDiscover();
      await refetchProjects();
      setBaseline(v);
      setSaved(`saved - discovered ${result.count ?? 0} repos under ${result.root ?? v.scanRoot}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err; // propagate so the guard does not navigate away on failure
    } finally {
      setSaving(false);
    }
  };

  const guard = useUnsavedGuard(dirty, save, reset);

  const isValidSubdir = (value: string): boolean => {
    if (value.length === 0) return false;
    return value
      .split("/")
      .every((p) => p.length > 0 && p !== "." && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p));
  };

  const addSubdir = () => {
    const value = newSubdir().trim();
    if (!value) return;
    if (!isValidSubdir(value)) {
      setSubdirError("letters, digits, . _ - per segment, separated by /");
      return;
    }
    if (subdirs().includes(value)) {
      setSubdirError("already in the list");
      return;
    }
    setSubdirs([...subdirs(), value]);
    setNewSubdir("");
    setSubdirError(null);
  };

  return (
    <section>
      <h3>scan and projects</h3>
      <form class="settings-fields" onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>
          scan root
          <input
            type="text"
            aria-label="scan root"
            placeholder="~/Projects"
            value={scanRoot()}
            oninput={(e) => setScanRoot(e.currentTarget.value)}
          />
          <span class="hint">absolute path or a ~/ path. must exist.</span>
        </label>
        <label>
          poll interval (ms)
          <input
            type="number"
            aria-label="poll interval (ms)"
            min={1000}
            step={1000}
            value={pollMs()}
            oninput={(e) => setPollMs(parseInt(e.currentTarget.value, 10))}
          />
        </label>

        <div>
          <span class="label">project sub-dirs</span>
          <div class="subdir-chips">
            <For each={subdirs()}>
              {(s) => (
                <span class="subdir-chip">
                  {s}
                  <button
                    type="button"
                    title="remove"
                    onclick={() => setSubdirs(subdirs().filter((x) => x !== s))}
                  >x</button>
                </span>
              )}
            </For>
            <Show when={subdirs().length === 0}>
              <span class="muted">no sub-dirs - projects land directly under the scan root</span>
            </Show>
          </div>
          <div class="subdir-add-row">
            <input
              type="text"
              aria-label="add sub-dir"
              placeholder="e.g. Personal or Professional/Customers"
              value={newSubdir()}
              oninput={(e) => setNewSubdir(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubdir(); } }}
            />
            <button type="button" onclick={addSubdir}>+ add</button>
          </div>
          <Show when={subdirError()}>
            <span class="hint" style={{ color: "var(--error)" }}>{subdirError()}</span>
          </Show>
        </div>

        <div class="settings-save">
          <button type="submit" disabled={saving() || !dirty()}>
            {saving() ? "saving" : "save"}
          </button>
          <Show when={saved()}><span class="settings-saved">{saved()}</span></Show>
        </div>
        <Show when={error()}>
          <div class="banner banner-error">{error()}</div>
        </Show>
      </form>
      <UnsavedDialog guard={guard} />
    </section>
  );
}
```

> The remove-chip button uses a plain `x` here rather than the multiplication sign the old markup used. Either is fine; keep whichever matches the rest of the codebase when you write it.

- [ ] **Step 4: Write TerminalsSection**

```tsx
// web/src/components/settings/TerminalsSection.tsx
import { createEffect, createSignal, Show } from "solid-js";
import { patchConfig } from "../../api";
import { useSettingsConfig } from "../../lib/settings-config";
import { useUnsavedGuard } from "../../lib/settings-dirty";
import UnsavedDialog from "./UnsavedDialog";

type Values = { maxTotal: number; maxScrollback: number; shell: string };

export default function TerminalsSection() {
  const { config } = useSettingsConfig();

  const [baseline, setBaseline] = createSignal<Values | null>(null);
  const [maxTotal, setMaxTotal] = createSignal(32);
  const [maxScrollback, setMaxScrollback] = createSignal(10_000);
  const [shell, setShell] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const c = config();
    if (!c || baseline()) return;
    const v: Values = {
      maxTotal: c.sessionMaxTotal ?? 32,
      maxScrollback: c.sessionMaxScrollbackLines ?? 10_000,
      shell: c.sessionDefaultShell ?? "",
    };
    setMaxTotal(v.maxTotal);
    setMaxScrollback(v.maxScrollback);
    setShell(v.shell);
    setBaseline(v);
  });

  const current = (): Values => ({
    maxTotal: maxTotal(), maxScrollback: maxScrollback(), shell: shell(),
  });

  const dirty = () => {
    const b = baseline();
    if (!b) return false;
    const c = current();
    return b.maxTotal !== c.maxTotal || b.maxScrollback !== c.maxScrollback || b.shell !== c.shell;
  };

  const reset = () => {
    const b = baseline();
    if (!b) return;
    setMaxTotal(b.maxTotal);
    setMaxScrollback(b.maxScrollback);
    setShell(b.shell);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const v = current();
      await patchConfig({
        sessionMaxTotal: v.maxTotal,
        sessionMaxScrollbackLines: v.maxScrollback,
        sessionDefaultShell: v.shell,
      });
      setBaseline(v);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const guard = useUnsavedGuard(dirty, save, reset);

  return (
    <section>
      <h3>terminals</h3>
      <form class="settings-fields" onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>
          max total sessions
          <input
            type="number" aria-label="max total sessions" min={1} step={1}
            value={maxTotal()}
            oninput={(e) => setMaxTotal(parseInt(e.currentTarget.value, 10))}
          />
        </label>
        <label>
          max scrollback lines
          <input
            type="number" aria-label="max scrollback lines" min={100} step={100}
            value={maxScrollback()}
            oninput={(e) => setMaxScrollback(parseInt(e.currentTarget.value, 10))}
          />
        </label>
        <label>
          default shell
          <input
            type="text" aria-label="default shell" placeholder="$SHELL"
            value={shell()}
            oninput={(e) => setShell(e.currentTarget.value)}
          />
          <span class="hint">leave blank to use $SHELL or /bin/bash.</span>
        </label>
        <div class="settings-save">
          <button type="submit" disabled={saving() || !dirty()}>
            {saving() ? "saving" : "save"}
          </button>
          <Show when={saved() && !dirty()}><span class="settings-saved">saved</span></Show>
        </div>
        <Show when={error()}>
          <div class="banner banner-error">{error()}</div>
        </Show>
      </form>
      <UnsavedDialog guard={guard} />
    </section>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd web && bun run test -- Settings.sections`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add web/src/components/settings/ScanSection.tsx \
        web/src/components/settings/TerminalsSection.tsx \
        web/tests/Settings.sections.test.tsx
git commit -m "feat(settings): scan and terminals sections with per-section save"
```

---

### Task 18: Launchers, Integrations, and System sections

**Files:**
- Create: `web/src/components/settings/LaunchersSection.tsx`, `web/src/components/settings/IntegrationsSection.tsx`, `web/src/components/settings/SystemSection.tsx`
- Test: append to `web/tests/Settings.sections.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `web/tests/Settings.sections.test.tsx` (the mocks and `renderSection` helper from Task 17 are reused; extend `CONFIG` with a launcher and a config dir):

```tsx
import LaunchersSection from "../src/components/settings/LaunchersSection";
import SystemSection from "../src/components/settings/SystemSection";

// Extend the Task 17 CONFIG constant with:
//   launchers: [{ id: "shell", label: "shell", command: null, args: [] }],
//   claudeConfigDirs: [{ path: "/home/u/.claude-work", profile: "work" }],

describe("LaunchersSection", () => {
  test("saves only the launcher list", async () => {
    renderSection(LaunchersSection);
    const label = await screen.findByDisplayValue("shell");
    fireEvent.input(label, { target: { value: "bash" } });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
    expect(patchConfig).toHaveBeenCalledWith({
      launchers: [{ id: "shell", label: "bash", command: null, args: [] }],
    });
    expect(runDiscover).not.toHaveBeenCalled();
  });

  test("adding a launcher marks the section dirty", async () => {
    renderSection(LaunchersSection);
    const save = await screen.findByText("save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("+ add launcher"));
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SystemSection", () => {
  test("lists detected claude config dirs read-only", async () => {
    renderSection(SystemSection);
    expect(await screen.findByText("work")).toBeTruthy();
    expect(screen.getByText("/home/u/.claude-work")).toBeTruthy();
    expect(screen.queryByText("save")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- Settings.sections`
Expected: FAIL — the three modules are still stubs.

- [ ] **Step 3: Write LaunchersSection**

The row markup and reorder logic are lifted from the old `Settings.tsx:194-276` unchanged; what is new is the baseline/dirty/save wrapper.

```tsx
// web/src/components/settings/LaunchersSection.tsx
import { createEffect, createSignal, For, Show } from "solid-js";
import { patchConfig } from "../../api";
import { useSettingsConfig, type LauncherEntry } from "../../lib/settings-config";
import { useUnsavedGuard } from "../../lib/settings-dirty";
import UnsavedDialog from "./UnsavedDialog";

export default function LaunchersSection() {
  const { config } = useSettingsConfig();

  const [baseline, setBaseline] = createSignal<string | null>(null);
  const [launchers, setLaunchers] = createSignal<LauncherEntry[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // The launcher list is compared by serialised form: it is an array of objects
  // with reorderable positions, so a structural compare is simpler than field
  // -by-field and cheap at this size.
  createEffect(() => {
    const c = config();
    if (!c || baseline() !== null) return;
    const list = c.launchers ?? [];
    setLaunchers(list);
    setBaseline(JSON.stringify(list));
  });

  const dirty = () => baseline() !== null && JSON.stringify(launchers()) !== baseline();

  const reset = () => {
    const b = baseline();
    if (b === null) return;
    setLaunchers(JSON.parse(b) as LauncherEntry[]);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const list = launchers();
      await patchConfig({ launchers: list });
      setBaseline(JSON.stringify(list));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const guard = useUnsavedGuard(dirty, save, reset);

  // Date.now() keeps ids unique within a session; the server does not care what
  // the id is, only that it is stable across a reorder.
  const addLauncher = () =>
    setLaunchers((arr) => [
      ...arr,
      { id: `custom-${Date.now()}`, label: "new", command: null, args: [] },
    ]);

  const removeLauncher = (i: number) => setLaunchers((arr) => arr.filter((_, j) => j !== i));

  const updateLauncher = (i: number, patch: Partial<LauncherEntry>) =>
    setLaunchers((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const moveLauncher = (i: number, dir: -1 | 1) => {
    const arr = launchers();
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const next = [...arr];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setLaunchers(next);
  };

  return (
    <section>
      <h3>launchers</h3>
      <span class="hint">entries available from the new-terminal split button</span>
      <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <Show when={launchers().length > 0} fallback={
          <div class="muted" style={{ padding: "0.3rem 0" }}>no launchers configured</div>
        }>
          <div class="launcher-list">
            <For each={launchers()}>
              {(l, i) => (
                <div class="launcher-row">
                  <div class="launcher-reorder">
                    <button type="button" class="launcher-move" title="move up"
                      disabled={i() === 0} onclick={() => moveLauncher(i(), -1)}>up</button>
                    <button type="button" class="launcher-move" title="move down"
                      disabled={i() === launchers().length - 1}
                      onclick={() => moveLauncher(i(), 1)}>down</button>
                  </div>
                  <div class="launcher-fields">
                    <label class="launcher-field-label">
                      label
                      <input type="text" value={l.label}
                        oninput={(e) => updateLauncher(i(), { label: e.currentTarget.value })} />
                    </label>
                    <label class="launcher-field-label">
                      command
                      <input type="text" value={l.command ?? ""} placeholder="blank = default shell"
                        oninput={(e) => updateLauncher(i(), { command: e.currentTarget.value || null })} />
                    </label>
                    <label class="launcher-field-label">
                      args
                      <input type="text" value={l.args.join(" ")} placeholder="space-separated"
                        oninput={(e) =>
                          updateLauncher(i(), { args: e.currentTarget.value.split(/\s+/).filter(Boolean) })
                        } />
                    </label>
                    <label class="launcher-field-label">
                      agent tag
                      <input type="text" value={l.agent ?? ""} placeholder="e.g. claude"
                        oninput={(e) => updateLauncher(i(), { agent: e.currentTarget.value || undefined })} />
                    </label>
                  </div>
                  <button type="button" class="launcher-remove" title="remove"
                    onclick={() => removeLauncher(i())}>remove</button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <div class="settings-row" style={{ "margin-top": "0.4rem" }}>
          <button type="button" onclick={addLauncher}>+ add launcher</button>
        </div>
        <div class="settings-save">
          <button type="submit" disabled={saving() || !dirty()}>
            {saving() ? "saving" : "save"}
          </button>
          <Show when={saved() && !dirty()}><span class="settings-saved">saved</span></Show>
        </div>
        <Show when={error()}>
          <div class="banner banner-error">{error()}</div>
        </Show>
      </form>
      <UnsavedDialog guard={guard} />
    </section>
  );
}
```

- [ ] **Step 4: Write IntegrationsSection**

`BbsSettings` already owns its own fetch and save button, so this is a heading plus the existing component. No guard: nothing in this section is held outside `BbsSettings`.

```tsx
// web/src/components/settings/IntegrationsSection.tsx
import BbsSettings from "../BbsSettings";

export default function IntegrationsSection() {
  return (
    <section>
      <h3>integrations</h3>
      <BbsSettings />
    </section>
  );
}
```

- [ ] **Step 5: Write SystemSection**

Read-only, so no save button and no guard.

```tsx
// web/src/components/settings/SystemSection.tsx
import { For, Show } from "solid-js";
import { useSettingsConfig } from "../../lib/settings-config";

export default function SystemSection() {
  const { config } = useSettingsConfig();
  const dirs = () => config()?.claudeConfigDirs ?? [];

  return (
    <section>
      <h3>system</h3>
      <span class="hint">
        detected automatically - Forest scans transcripts and installs hooks into each
      </span>
      <Show
        when={dirs().length > 0}
        fallback={<div class="muted" style={{ padding: "0.3rem 0" }}>no claude config dirs detected</div>}
      >
        <ul class="config-dirs-list">
          <For each={dirs()}>
            {(d) => (
              <li>
                <span class="config-dir-profile">{d.profile}</span> <code>{d.path}</code>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `cd web && bun run test -- Settings.sections`
Expected: PASS, 7 tests

- [ ] **Step 7: Confirm the old page is fully replaced**

```bash
grep -n "max-width: 480px" web/src/styles.css
wc -l web/src/pages/Settings.tsx
```

Expected: no match for the first (removed in Task 7), and roughly 30 lines for the second.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/settings/ web/tests/Settings.sections.test.tsx
git commit -m "feat(settings): launchers, integrations, and system sections"
```

---

### Task 19: Appearance and Dashboard sections

Both write to localStorage and apply instantly, so neither has a save button and neither needs the guard.

**Files:**
- Create: `web/src/components/settings/AppearanceSection.tsx`, `web/src/components/settings/DashboardSection.tsx`
- Test: `web/tests/AppearanceSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/AppearanceSection.test.tsx
import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import AppearanceSection from "../src/components/settings/AppearanceSection";
import DashboardSection from "../src/components/settings/DashboardSection";
import { THEMES } from "../src/lib/themes/index";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("AppearanceSection", () => {
  test("renders a card for every theme", () => {
    render(() => <AppearanceSection />);
    for (const theme of THEMES) {
      expect(screen.getByRole("button", { name: new RegExp(theme.name, "i") })).toBeTruthy();
    }
  });

  test("groups cards by family", () => {
    render(() => <AppearanceSection />);
    for (const family of new Set(THEMES.map((t) => t.family))) {
      expect(screen.getByText(family)).toBeTruthy();
    }
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

  test("marks the active theme", () => {
    localStorage.setItem("forest.theme", JSON.stringify("nord"));
    render(() => <AppearanceSection />);
    const card = screen.getByRole("button", { name: /nord/i });
    expect(card.className).toContain("active");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- AppearanceSection`
Expected: FAIL — both modules are still stubs.

- [ ] **Step 3: Write AppearanceSection**

Clicking applies the theme to the whole app immediately, so the app itself is the preview. Light and dark families group separately so a light theme cannot ambush someone scanning dark ones.

```tsx
// web/src/components/settings/AppearanceSection.tsx
import { For } from "solid-js";
import { THEMES } from "../../lib/themes/index";
import { setTheme, themeId } from "../../lib/themes/current";
import type { Theme } from "../../lib/themes/types";

// Families in registry order, split so all dark families come before light ones.
function familyGroups(): Array<{ family: string; scheme: string; themes: Theme[] }> {
  const groups = new Map<string, Theme[]>();
  for (const t of THEMES) {
    const key = `${t.family}::${t.scheme}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .map(([key, themes]) => {
      const [family, scheme] = key.split("::") as [string, string];
      return { family, scheme, themes };
    })
    .sort((a, b) => (a.scheme === b.scheme ? 0 : a.scheme === "dark" ? -1 : 1));
}

export default function AppearanceSection() {
  return (
    <section>
      <h3>appearance</h3>
      <span class="hint">applies immediately and is remembered on this device only</span>
      <For each={familyGroups()}>
        {(group) => (
          <div class="theme-family">
            <div class="theme-family-name">
              {group.family}
              {group.scheme === "light" ? " (light)" : ""}
            </div>
            <div class="theme-grid">
              <For each={group.themes}>
                {(theme) => (
                  <button
                    type="button"
                    class={`theme-card${themeId() === theme.id ? " active" : ""}`}
                    aria-label={theme.name}
                    aria-pressed={themeId() === theme.id}
                    onclick={() => setTheme(theme.id)}
                  >
                    <span class="theme-swatch">
                      <span style={{ background: theme.tokens.bg }} />
                      <span style={{ background: theme.tokens.bg3 }} />
                      <span style={{ background: theme.tokens.accent }} />
                      <span style={{ background: theme.tokens.ok }} />
                    </span>
                    <span class="theme-card-name">{theme.name}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </section>
  );
}
```

- [ ] **Step 4: Write DashboardSection**

```tsx
// web/src/components/settings/DashboardSection.tsx
import { autoRefresh, setAutoRefresh } from "../../lib/preferences";

export default function DashboardSection() {
  return (
    <section>
      <h3>dashboard</h3>
      <span class="hint">applies immediately and is remembered on this device only</span>
      <div class="settings-fields">
        <label class="checkbox-row">
          <input
            type="checkbox"
            checked={autoRefresh()}
            onchange={(e) => setAutoRefresh(e.currentTarget.checked)}
          />
          auto-refresh dashboard every 5s
        </label>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd web && bun run test -- AppearanceSection`
Expected: PASS, 6 tests

- [ ] **Step 6: Try it**

Run `bun run dev:web`, open http://localhost:5173/settings. Click through every theme and confirm the whole page recolors live. Switch to Latte, reload, and confirm there is no dark flash before paint.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/settings/AppearanceSection.tsx \
        web/src/components/settings/DashboardSection.tsx \
        web/tests/AppearanceSection.test.tsx
git commit -m "feat(settings): theme picker and dashboard preferences"
```

---

### Task 20: Mobile theme picker

The theme is per-device, so a phone gets its own choice — but `/m` has no settings surface today. This adds exactly one control, not a settings page.

**Files:**
- Create: `web/src/pages/mobile/ThemeSheet.tsx`
- Modify: `web/src/pages/mobile/MobileLayout.tsx`, `web/src/pages/mobile/mobile.css`
- Test: `web/tests/mobile-ThemeSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/mobile-ThemeSheet.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- mobile-ThemeSheet`
Expected: FAIL — cannot resolve `../src/pages/mobile/ThemeSheet`

- [ ] **Step 3: Write the sheet**

```tsx
// web/src/pages/mobile/ThemeSheet.tsx
import { createSignal, For, Show } from "solid-js";
import { THEMES } from "../../lib/themes/index";
import { setTheme, themeId, currentTheme } from "../../lib/themes/current";

// The only settings affordance on /m. Deliberately one control: the theme is
// per-device localStorage, so a phone would otherwise be stuck on whatever the
// default is.
export default function ThemeSheet() {
  const [open, setOpen] = createSignal(false);

  const pick = (id: string) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        class="m-theme-button"
        aria-label="theme"
        onclick={() => setOpen(true)}
      >
        <span class="m-theme-dot" style={{ background: currentTheme().tokens.accent }} />
      </button>

      <Show when={open()}>
        <div
          class="m-sheet-backdrop"
          data-testid="theme-sheet-backdrop"
          onclick={() => setOpen(false)}
        />
        <div class="m-sheet" role="dialog" aria-modal="true" aria-label="choose a theme">
          <div class="m-sheet-title">theme</div>
          <div class="m-sheet-list">
            <For each={THEMES}>
              {(theme) => (
                <button
                  type="button"
                  class={`m-sheet-row${themeId() === theme.id ? " active" : ""}`}
                  aria-label={theme.name}
                  onclick={() => pick(theme.id)}
                >
                  <span class="m-sheet-swatch">
                    <span style={{ background: theme.tokens.bg }} />
                    <span style={{ background: theme.tokens.accent }} />
                    <span style={{ background: theme.tokens.ok }} />
                  </span>
                  <span class="m-sheet-name">{theme.name}</span>
                  <span class="m-sheet-family">{theme.family}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </>
  );
}
```

- [ ] **Step 4: Mount it in the mobile bar**

In `web/src/pages/mobile/MobileLayout.tsx`, import the sheet and add it to `.m-bar`. The bar becomes a flex row so the button sits at the right edge:

```tsx
import ThemeSheet from "./ThemeSheet";

// ...inside the component, replace the existing .m-bar div:
      <div class="m-bar">
        <Show when={!atRoot()} fallback={<span class="m-brand"><span class="m-brand-mark">f</span>orest</span>}>
          <button type="button" class="m-back" onClick={() => navigate("/m")}>back to sessions</button>
        </Show>
        <ThemeSheet />
      </div>
```

> Keep the existing brand glyph and back-label text exactly as they are in the file — only the added `<ThemeSheet />` and the flex layout below are new.

- [ ] **Step 5: Add the mobile styles**

Append to `web/src/pages/mobile/mobile.css`:

```css
/* theme sheet */
.m-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.m-theme-button {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px;
  padding: 0.25rem 0.4rem; cursor: pointer; line-height: 0; flex: 0 0 auto;
}
.m-theme-dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; }
.m-sheet-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 40; }
.m-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 41;
  max-height: 70vh; overflow: auto;
  background: var(--bg-2); border-top: 1px solid var(--border);
  border-radius: 10px 10px 0 0; padding: 0.6rem 0 1.2rem;
}
.m-sheet-title {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--fg-dim); padding: 0 0.9rem 0.5rem;
}
.m-sheet-list { display: flex; flex-direction: column; }
.m-sheet-row {
  display: flex; align-items: center; gap: 0.6rem;
  background: none; border: 0; color: var(--fg); font: inherit;
  text-align: left; padding: 0.6rem 0.9rem; cursor: pointer;
}
.m-sheet-row.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.m-sheet-swatch { display: flex; width: 42px; height: 18px; border-radius: 3px; overflow: hidden; border: 1px solid var(--border); }
.m-sheet-swatch span { flex: 1; }
.m-sheet-name { flex: 1; }
.m-sheet-family { color: var(--fg-dim); font-size: 0.75rem; }
```

- [ ] **Step 6: Run tests**

Run: `cd web && bun run test -- mobile-ThemeSheet`
Expected: PASS, 4 tests

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/mobile/ web/tests/mobile-ThemeSheet.test.tsx
git commit -m "feat(mobile): theme picker sheet in the mobile bar"
```

---

### Task 21: Documentation and final verification

- [ ] **Step 1: Update the spec's contrast rule**

The spec's §5 still states hard 3:1 floors on `accent`, `ok`, and `error`. Replace those three bullets in `docs/superpowers/specs/2026-07-24-theming-and-settings-layout-design.md` with the two-tier rule actually implemented in Task 12:

```markdown
- contrast floors on the pairs our mapping controls: `fg`/`bg` >= 4.5:1,
  `fg-dim`/`bg` >= 3:1, `accentFg`/`accent` >= 4.5:1
- a gross-error floor of 2:1 on `accent`/`ok`/`warn`/`error`/`info` against
  `bg`. Published role hues are the palette author's decision — Catppuccin
  Latte's own green is 2.96:1 and its yellow 2.31:1 — so the test catches a
  role mapped to the wrong palette entry without overriding upstream design.
  The full role-contrast table is printed on every run.
```

- [ ] **Step 2: Document theming in the README**

Add to `README.md`, after the "How it works" section:

```markdown
### Theming

Forest ships 16 themes — Catppuccin (Latte, Frappé, Macchiato, Mocha), Rosé Pine
and Dawn, Gruvbox Dark/Light, One Dark/Light, Solarized Dark/Light, Dracula,
Nord, Tokyo Night, and the original Forest Dark. Pick one under
**Settings → Appearance**, or from the swatch button in the mobile bar on `/m`.

The choice is per-device (stored in `localStorage`), so your laptop and your
phone can differ. Themes cover the app chrome, the code editor's syntax
highlighting, charts, and mermaid diagrams.

Terminal ANSI colors 0–15 are deliberately **not** themed: programs running in
the PTY pick their own colors, and modern prompts emit 24-bit truecolor that no
theme should override. Only the terminal's background, foreground, and cursor
follow the theme.

Adding a theme is one file under `web/src/lib/themes/` plus one line in
`index.ts`; `buildTheme()` expands a published palette into the full token set,
and the test suite checks completeness and contrast automatically.
```

- [ ] **Step 3: Run the full web suite**

Run: `cd web && bun run test`
Expected: every suite passes, including the pre-existing `BbsSettings`, `charts`, `Markdown`, `FileEditor`, and mobile tests.

- [ ] **Step 4: Run the server suite**

Run: `cd server && bun test`
Expected: passes. Nothing in this plan touches the server — a failure here means something unrelated is broken, and it should not be attributed to this work.

- [ ] **Step 5: Verify the production build**

Run: `bun run build:web`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Confirm no hardcoded colors survive**

```bash
grep -rnE '#[0-9a-fA-F]{3,8}' web/src --include='*.tsx' --include='*.ts' \
  | grep -v 'src/lib/themes/'
```

Expected: no results. Every literal color should now live in a theme file.

```bash
grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' web/src/styles.css web/src/pages/mobile/mobile.css \
  | grep -v 'rgba(0, 0, 0'
```

Expected: only the `:root` fallback block from Task 5.

- [ ] **Step 7: Final manual pass**

With `bun run dev:web`, in **Catppuccin Mocha**:

- dashboard, sessions, archives, a project's every tab
- a diff with additions (**green**, not the mauve accent) and deletions
- the settings page: click each rail item, edit a field, try to navigate away, and exercise all three dialog outcomes
- reload with a light theme selected and confirm no dark flash

- [ ] **Step 8: Commit**

```bash
git add README.md docs/superpowers/specs/2026-07-24-theming-and-settings-layout-design.md
git commit -m "docs: document theming and align the spec's contrast rule"
```

---

## Self-review

**Spec coverage** — every section of the design doc maps to a task:

| Spec section | Tasks |
|---|---|
| §1 token set, `Theme` type, registry | 1, 2 |
| §1 `--accent` / `--ok` split | 5 |
| §1 `color-mix` conversion | 6 |
| §1 `applyTheme`, boot cache, no-flash | 3, 4 |
| §2 CSS surfaces | 5, 6, 14 |
| §2 CodeMirror | 8 |
| §2 xterm | 9 |
| §2 mermaid | 10 |
| §2 charts | 11 |
| §3 catalog + mapping recipe | 2, 12, 13 |
| §4 routing + decomposition | 15 |
| §4 save model | 17, 18, 19 |
| §4 unsaved guard | 16 |
| §4 appearance section | 19 |
| §4 mobile | 20 |
| §4 responsive + settings CSS | 7 |
| §5 testing | 12, 16, 17, 18, 19, 20, 21 |

**Known deviations from the spec**, both recorded above where they occur:

1. `build.ts` and `current.ts` are not in the spec's file list. `build.ts` makes the mapping recipe executable rather than copied into 16 files; `current.ts` keeps `index.ts` to registry assembly only.
2. The contrast floors are two-tier rather than a flat 3:1, for the reason given at the top of this plan. Task 21 Step 1 updates the spec to match.

**Ordering constraint:** Task 15 Step 5 registers routes pointing at the seven section components. Create them as `export default function X() { return null; }` stubs in that task so the build stays green, then fill them in during Tasks 17–19.
