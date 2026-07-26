import { createEffect, createSignal, Show } from "solid-js";
import { patchConfig } from "../../api";
import { useSettingsConfig } from "../../lib/settings-config";
import { useUnsavedGuard } from "../../lib/settings-dirty";
import UnsavedDialog from "./UnsavedDialog";

type Values = { maxTotal: number; maxScrollback: number; shell: string };

export default function TerminalsSection() {
  const { config } = useSettingsConfig();

  const [baseline, setBaseline] = createSignal<Values | null>(null);
  const [maxTotal, setMaxTotal] = createSignal(32);
  const [maxScrollback, setMaxScrollback] = createSignal(10_000);
  const [shell, setShell] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Seed from the server config once it arrives and record it as the baseline,
  // so dirty() starts false.
  createEffect(() => {
    const c = config();
    if (!c || baseline()) return;
    const v: Values = {
      maxTotal: c.sessionMaxTotal ?? 32,
      maxScrollback: c.sessionMaxScrollbackLines ?? 10_000,
      shell: c.sessionDefaultShell ?? "",
    };
    setMaxTotal(v.maxTotal);
    setMaxScrollback(v.maxScrollback);
    setShell(v.shell);
    setBaseline(v);
  });

  const current = (): Values => ({
    maxTotal: maxTotal(),
    maxScrollback: maxScrollback(),
    shell: shell(),
  });

  const dirty = () => {
    const b = baseline();
    if (!b) return false;
    const c = current();
    return b.maxTotal !== c.maxTotal || b.maxScrollback !== c.maxScrollback || b.shell !== c.shell;
  };

  const reset = () => {
    const b = baseline();
    if (!b) return;
    setMaxTotal(b.maxTotal);
    setMaxScrollback(b.maxScrollback);
    setShell(b.shell);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const v = current();
      // Only this section's fields. PATCH /api/config ignores absent keys.
      await patchConfig({
        sessionMaxTotal: v.maxTotal,
        sessionMaxScrollbackLines: v.maxScrollback,
        sessionDefaultShell: v.shell,
      });
      setBaseline(v);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err; // propagate so the guard does not navigate away on failure
    } finally {
      setSaving(false);
    }
  };

  const guard = useUnsavedGuard(dirty, save, reset);

  // An emptied number input parses to NaN. Letting that into a signal would
  // poison dirty() forever (NaN !== NaN), so keep the last valid number.
  const onNumber = (set: (n: number) => void) => (e: { currentTarget: HTMLInputElement }) => {
    const n = Number.parseInt(e.currentTarget.value, 10);
    if (Number.isFinite(n)) set(n);
  };

  return (
    <section>
      <h3>terminals</h3>
      <form class="settings-fields" onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>
          max total sessions
          <input
            type="number"
            aria-label="max total sessions"
            min={1}
            step={1}
            value={maxTotal()}
            oninput={onNumber(setMaxTotal)}
          />
        </label>
        <label>
          max scrollback lines
          <input
            type="number"
            aria-label="max scrollback lines"
            min={100}
            step={100}
            value={maxScrollback()}
            oninput={onNumber(setMaxScrollback)}
          />
        </label>
        <label>
          default shell
          <input
            type="text"
            aria-label="default shell"
            placeholder="$SHELL"
            value={shell()}
            oninput={(e) => setShell(e.currentTarget.value)}
          />
          <span class="hint">leave blank to use $SHELL or /bin/bash.</span>
        </label>
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
