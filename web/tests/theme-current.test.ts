// web/tests/theme-current.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { currentTheme, setTheme, themeId, initTheme } from "../src/lib/themes/current";
import { DEFAULT_THEME_ID, THEMES } from "../src/lib/themes/index";
import { BOOT_CACHE_KEY } from "../src/lib/themes/apply";

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

// The inline boot script in index.html is raw JS and cannot import from
// apply.ts, so it hardcodes the cache key and the cached shape. Nothing else
// ties the two together: rename BOOT_CACHE_KEY or drop a field from the cache
// and every existing test still passes, while the flash the cache exists to
// prevent silently comes back. These two assertions are that missing link.
describe("index.html boot script contract", () => {
  // Not `readFileSync(new URL("../index.html", import.meta.url))`: Vite
  // statically detects that exact `new URL(relative, import.meta.url)` AST
  // pattern and rewrites it into a dev-server asset URL
  // (`http://localhost:3000/index.html`), which readFileSync then rejects
  // ("must be of scheme file"). Building the path manually sidesteps that.
  const indexHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");
  const html = readFileSync(indexHtmlPath, "utf8");

  test("uses the real cache key", () => {
    expect(html).toContain(BOOT_CACHE_KEY);
  });

  test("reads the same shape applyTheme writes", () => {
    for (const prop of ["bg", "fg", "scheme"]) {
      expect(html, `boot script must read b.${prop}`).toContain(`b.${prop}`);
    }
  });
});
