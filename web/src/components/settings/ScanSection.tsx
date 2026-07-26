import { createEffect, createSignal, For, Show } from "solid-js";
import { patchConfig, runDiscover } from "../../api";
import { useProjects } from "../../projects-context";
import { useSettingsConfig } from "../../lib/settings-config";
import { useUnsavedGuard } from "../../lib/settings-dirty";
import UnsavedDialog from "./UnsavedDialog";

type Values = { scanRoot: string; pollMs: number; subdirs: string[] };

export default function ScanSection() {
  const { config } = useSettingsConfig();
  const { refetch: refetchProjects } = useProjects();

  const [baseline, setBaseline] = createSignal<Values | null>(null);
  const [scanRoot, setScanRoot] = createSignal("");
  const [pollMs, setPollMs] = createSignal(10_000);
  const [subdirs, setSubdirs] = createSignal<string[]>([]);
  const [newSubdir, setNewSubdir] = createSignal("");
  const [subdirError, setSubdirError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Seed from the server config once it arrives and record it as the baseline,
  // so dirty() starts false.
  createEffect(() => {
    const c = config();
    if (!c || baseline()) return;
    const v: Values = {
      scanRoot: c.scanRoot ?? "",
      pollMs: c.pollIntervalMs,
      subdirs: c.projectSubdirs ?? [],
    };
    setScanRoot(v.scanRoot);
    setPollMs(v.pollMs);
    setSubdirs(v.subdirs);
    setBaseline(v);
  });

  const current = (): Values => ({ scanRoot: scanRoot(), pollMs: pollMs(), subdirs: subdirs() });

  const dirty = () => {
    const b = baseline();
    if (!b) return false;
    const c = current();
    return (
      b.scanRoot !== c.scanRoot ||
      b.pollMs !== c.pollMs ||
      b.subdirs.join(" ") !== c.subdirs.join(" ")
    );
  };

  const reset = () => {
    const b = baseline();
    if (!b) return;
    setScanRoot(b.scanRoot);
    setPollMs(b.pollMs);
    setSubdirs(b.subdirs);
    setSubdirError(null);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const v = current();
      // Only this section's fields. PATCH /api/config ignores absent keys.
      await patchConfig({
        scanRoot: v.scanRoot,
        pollIntervalMs: v.pollMs,
        projectSubdirs: v.subdirs,
      });
      // Scan is the only section that changes what gets discovered.
      const result = await runDiscover();
      await refetchProjects();
      setBaseline(v);
      setSaved(`saved - discovered ${result.count ?? 0} repos under ${result.root ?? v.scanRoot}`);
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
  const onPollMs = (e: { currentTarget: HTMLInputElement }) => {
    const n = Number.parseInt(e.currentTarget.value, 10);
    if (Number.isFinite(n)) setPollMs(n);
  };

  const isValidSubdir = (value: string): boolean => {
    if (value.length === 0) return false;
    return value
      .split("/")
      .every((p) => p.length > 0 && p !== "." && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p));
  };

  const addSubdir = () => {
    const value = newSubdir().trim();
    if (!value) return;
    if (!isValidSubdir(value)) {
      setSubdirError("letters, digits, . _ - per segment, separated by /");
      return;
    }
    if (subdirs().includes(value)) {
      setSubdirError("already in the list");
      return;
    }
    setSubdirs([...subdirs(), value]);
    setNewSubdir("");
    setSubdirError(null);
  };

  return (
    <section>
      <h3>scan and projects</h3>
      <form class="settings-fields" onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>
          scan root
          <input
            type="text"
            aria-label="scan root"
            placeholder="~/Projects"
            value={scanRoot()}
            oninput={(e) => setScanRoot(e.currentTarget.value)}
          />
          <span class="hint">absolute path or a ~/ path. must exist.</span>
        </label>
        <label>
          poll interval (ms)
          <input
            type="number"
            aria-label="poll interval (ms)"
            min={1000}
            step={1000}
            value={pollMs()}
            oninput={onPollMs}
          />
        </label>

        <div>
          <span class="label">project sub-dirs</span>
          <div class="subdir-chips">
            <For each={subdirs()}>
              {(s) => (
                <span class="subdir-chip">
                  {s}
                  <button
                    type="button"
                    title="remove"
                    onclick={() => setSubdirs(subdirs().filter((x) => x !== s))}
                  >×</button>
                </span>
              )}
            </For>
            <Show when={subdirs().length === 0}>
              <span class="muted">no sub-dirs - projects land directly under the scan root</span>
            </Show>
          </div>
          <div class="subdir-add-row">
            <input
              type="text"
              aria-label="add sub-dir"
              placeholder="e.g. Personal or Professional/Customers"
              value={newSubdir()}
              oninput={(e) => setNewSubdir(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubdir(); } }}
            />
            <button type="button" onclick={addSubdir}>+ add</button>
          </div>
          <Show when={subdirError()}>
            <span class="hint" style={{ color: "var(--error)" }}>{subdirError()}</span>
          </Show>
        </div>

        <div class="settings-save">
          <button type="submit" disabled={saving() || !dirty()}>
            {saving() ? "saving" : "save"}
          </button>
          <Show when={saved() && !dirty()}><span class="settings-saved">{saved()}</span></Show>
        </div>
        <Show when={error()}>
          <div class="banner banner-error">{error()}</div>
        </Show>
      </form>
      <UnsavedDialog guard={guard} />
    </section>
  );
}
