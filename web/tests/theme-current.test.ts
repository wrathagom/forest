// web/tests/theme-current.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { currentTheme, setTheme, themeId, initTheme } from "../src/lib/themes/current";
import { DEFAULT_THEME_ID, THEMES } from "../src/lib/themes/index";
import { BOOT_CACHE_KEY } from "../src/lib/themes/apply";
import html from "../index.html?raw";

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
  // All 38 tokens, so a future recipe change to any of them fails mechanically
  // instead of relying on eyeballing the theme file. `bg3`, `fgFaint`,
  // `borderStrong`, and `accentFg` have no pre-existing single-value
  // counterpart in styles.css (see forest-dark.ts's own comments) — these
  // four pin the value the theme declares today, so drift is still caught.
  test.each([
    ["bg", "#0e0e10"], ["bg2", "#1a1a1d"], ["bg3", "#0e0e10"],
    ["fg", "#e6e6e6"], ["fgDim", "#9a9a9a"], ["fgFaint", "#666666"],
    ["border", "#2a2a2d"], ["borderStrong", "#3a3a3d"],
    ["accent", "#6ee7b7"], ["accentFg", "#0e0e10"],
    ["ok", "#6ee7b7"], ["warn", "#f59e0b"], ["error", "#f87171"], ["info", "#82aaff"],
    ["synKeyword", "#c792ea"], ["synString", "#c3e88d"], ["synNumber", "#f78c6c"],
    ["synFunction", "#82aaff"], ["synProperty", "#82aaff"], ["synType", "#ffcb6b"],
    ["synTag", "#f07178"], ["synComment", "#546e7a"], ["synOperator", "#89ddff"],
    ["synInvalid", "#ff5370"],
    ["chart1", "#60a5fa"], ["chart2", "#f472b6"], ["chart3", "#34d399"], ["chart4", "#fbbf24"],
    ["chart5", "#a78bfa"], ["chart6", "#22d3ee"], ["chart7", "#fb923c"], ["chart8", "#a3e635"],
    ["termBg", "#0e0e10"], ["termFg", "#e6e6e6"], ["termCursor", "#6ee7b7"],
    ["tokIn", "#6ee7b7"], ["tokOut", "#f59e0b"], ["tokCache", "#8b5cf6"],
  ] as const)("%s is unchanged", (key, expected) => {
    expect(forest.tokens[key]).toBe(expected);
  });
});

// The inline boot script in index.html is raw JS and cannot import from
// apply.ts, so it hardcodes the cache key and the cached shape. Nothing else
// ties the two together: rename BOOT_CACHE_KEY or drop a field from the cache
// and every existing test still passes, while the flash the cache exists to
// prevent silently comes back. These two assertions are that missing link.
describe("index.html boot script contract", () => {
  // `?raw` is Vite-native and already typed by `vite/client` (already in
  // web/tsconfig.json's `types` array), so this needs no filesystem access
  // and no @types/node. Not `readFileSync(new URL("../index.html",
  // import.meta.url))`: Vite statically rewrites that exact AST pattern into
  // a dev-server asset URL (`http://localhost:3000/index.html`), which
  // readFileSync then rejects.
  test("uses the real cache key", () => {
    expect(html).toContain(BOOT_CACHE_KEY);
  });

  test("reads the same shape applyTheme writes", () => {
    for (const prop of ["bg", "fg", "scheme"]) {
      expect(html, `boot script must read b.${prop}`).toContain(`b.${prop}`);
    }
  });
});
