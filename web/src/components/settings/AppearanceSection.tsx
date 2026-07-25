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
