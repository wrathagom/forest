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
  // Ignore an unknown id rather than persisting it. The appearance picker keys
  // its selected state on themeId(), so storing a value with no matching theme
  // would leave every card unselected while the default renders underneath.
  if (!THEME_BY_ID[id]) return;
  setThemeId(id);
  applyTheme(currentTheme());
}

// Called once from main.tsx before render.
export function initTheme(): void {
  applyTheme(currentTheme());
}
