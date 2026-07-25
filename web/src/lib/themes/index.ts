// web/src/lib/themes/index.ts
import type { Theme } from "./types";
import { forestDark } from "./forest-dark";
import {
  catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha,
} from "./catppuccin";

export type { Theme, ThemeTokens, ThemeScheme } from "./types";
export { TOKEN_KEYS } from "./types";
export { applyTheme, cssVarName, BOOT_CACHE_KEY } from "./apply";

// Order here is the order families appear in the theme picker.
export const THEMES: Theme[] = [
  forestDark,
  catppuccinLatte, catppuccinFrappe, catppuccinMacchiato, catppuccinMocha,
];

export const DEFAULT_THEME_ID = forestDark.id;

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
);
