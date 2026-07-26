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
