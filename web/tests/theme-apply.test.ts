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
