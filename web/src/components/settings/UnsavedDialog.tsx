import { Show, createSignal } from "solid-js";
import type { UnsavedGuard } from "../../lib/settings-dirty";

export default function UnsavedDialog(props: { guard: UnsavedGuard }) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.guard.saveAndContinue();
    } catch (err) {
      // The guard leaves the navigation blocked when save() rejects; show why
      // rather than letting the rejection go unhandled behind an open dialog.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Show when={props.guard.pending()}>
      <div class="modal-backdrop">
        <div class="guard-dialog" role="dialog" aria-modal="true" aria-label="unsaved changes">
          <div class="guard-dialog-body">
            <p>You have unsaved changes in this section.</p>
            <Show when={error()}>
              <p class="guard-dialog-error">{error()}</p>
            </Show>
            <div class="guard-dialog-actions">
              <button
                type="button"
                onclick={() => { setError(null); props.guard.stay(); }}
              >cancel</button>
              <button type="button" class="danger" onclick={() => props.guard.discardAndContinue()}>
                discard
              </button>
              <button type="button" class="primary" disabled={saving()} onclick={onSave}>
                {saving() ? "saving…" : "save & continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
