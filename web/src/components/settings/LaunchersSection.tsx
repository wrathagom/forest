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
  // with reorderable positions, so a structural compare is simpler than
  // field-by-field and cheap at this size.
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
      // Only this section's field. PATCH /api/config ignores absent keys.
      await patchConfig({ launchers: list });
      setBaseline(JSON.stringify(list));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err; // propagate so the guard does not navigate away on failure
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
        <Show
          when={launchers().length > 0}
          fallback={<div class="muted" style={{ padding: "0.3rem 0" }}>no launchers configured</div>}
        >
          <div class="launcher-list">
            <For each={launchers()}>
              {(l, i) => (
                <div class="launcher-row">
                  <div class="launcher-reorder">
                    <button
                      type="button"
                      class="launcher-move"
                      title="move up"
                      disabled={i() === 0}
                      onclick={() => moveLauncher(i(), -1)}
                    >▲</button>
                    <button
                      type="button"
                      class="launcher-move"
                      title="move down"
                      disabled={i() === launchers().length - 1}
                      onclick={() => moveLauncher(i(), 1)}
                    >▼</button>
                  </div>
                  <div class="launcher-fields">
                    <label class="launcher-field-label">
                      label
                      <input
                        type="text"
                        value={l.label}
                        oninput={(e) => updateLauncher(i(), { label: e.currentTarget.value })}
                      />
                    </label>
                    <label class="launcher-field-label">
                      command
                      <input
                        type="text"
                        value={l.command ?? ""}
                        placeholder="blank = default shell"
                        oninput={(e) => updateLauncher(i(), { command: e.currentTarget.value || null })}
                      />
                    </label>
                    <label class="launcher-field-label">
                      args
                      <input
                        type="text"
                        value={l.args.join(" ")}
                        placeholder="space-separated"
                        oninput={(e) =>
                          updateLauncher(i(), { args: e.currentTarget.value.split(/\s+/).filter(Boolean) })
                        }
                      />
                    </label>
                    <label class="launcher-field-label">
                      agent tag
                      <input
                        type="text"
                        value={l.agent ?? ""}
                        placeholder="e.g. claude"
                        oninput={(e) => updateLauncher(i(), { agent: e.currentTarget.value || undefined })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    class="launcher-remove"
                    title="remove"
                    onclick={() => removeLauncher(i())}
                  >×</button>
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
