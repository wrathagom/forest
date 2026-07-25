import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { THEMES } from "../../lib/themes/index";
import { setTheme, themeId, currentTheme } from "../../lib/themes/current";

// The only settings affordance on /m. Deliberately one control: the theme is
// per-device localStorage, so a phone would otherwise be stuck on whatever the
// default is.
export default function ThemeSheet() {
  const [open, setOpen] = createSignal(false);
  let list: HTMLDivElement | undefined;

  const pick = (id: string) => {
    setTheme(id);
    setOpen(false);
  };

  createEffect(() => {
    if (!open()) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));

    // Sixteen rows do not fit: opening while on one of the last themes would
    // otherwise land at the top with the selection off-screen. `?.` on the
    // method matches SessionDetail.tsx — jsdom has no scrollIntoView.
    list?.querySelector(".m-sheet-row.active")?.scrollIntoView?.({ block: "center" });
  });

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
        {/* role="dialog" without aria-modal: nothing here traps focus, and the
            list behind the backdrop stays reachable, so claiming modality would
            tell a screen reader something untrue. Escape and the backdrop are
            the two ways out. */}
        <div class="m-sheet" role="dialog" aria-label="choose a theme">
          <div class="m-sheet-title">theme</div>
          <div class="m-sheet-list" ref={list}>
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
