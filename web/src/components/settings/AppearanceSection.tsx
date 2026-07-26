import { For, Show } from "solid-js";
import { THEMES } from "../../lib/themes/index";
import { setTheme, themeId } from "../../lib/themes/current";
import type { Theme, ThemeScheme } from "../../lib/themes/types";

// Two groups, dark then light: a light theme must not ambush someone scanning
// the dark ones. Grouping by family instead produced fourteen headings for
// sixteen themes, thirteen of them holding a single card, which read as a list
// wearing a grid's clothes. The family moved onto the card, so families still
// sit together (registry order is preserved within each scheme) without
// costing a heading each.
const SCHEME_ORDER: ThemeScheme[] = ["dark", "light"];

function schemeGroups(): Array<{ scheme: ThemeScheme; themes: Theme[] }> {
  return SCHEME_ORDER.map((scheme) => ({
    scheme,
    themes: THEMES.filter((t) => t.scheme === scheme),
  })).filter((g) => g.themes.length > 0);
}

export default function AppearanceSection() {
  return (
    <section>
      <h3>appearance</h3>
      <span class="hint">applies immediately and is remembered on this device only</span>
      <For each={schemeGroups()}>
        {(group) => (
          <div class="theme-family">
            <div class="theme-family-name">{group.scheme}</div>
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
                    <span class="theme-card-label">
                      <span class="theme-card-name">{theme.name}</span>
                      {/* Four themes are the only member of a family named
                          after them; "Dracula / Dracula" is worse than one line. */}
                      <Show when={theme.family !== theme.name}>
                        <span class="theme-card-family">{theme.family}</span>
                      </Show>
                    </span>
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
