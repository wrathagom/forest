import { createSignal, onCleanup, type Accessor } from "solid-js";
import { useBeforeLeave, type BeforeLeaveEventArgs } from "@solidjs/router";

export type UnsavedGuard = {
  /** true while a navigation is blocked awaiting the user's decision */
  pending: Accessor<boolean>;
  saveAndContinue: () => Promise<void>;
  discardAndContinue: () => void;
  stay: () => void;
};

/**
 * Blocks in-app navigation away from a section with unsaved edits, and warns on
 * tab close. `save` must update the section's baseline so the section is clean
 * afterwards; `reset` must restore fields to the last-loaded values.
 *
 * Only one section is mounted at a time, so there is no cross-section dirty
 * state to reconcile.
 */
export function useUnsavedGuard(
  dirty: Accessor<boolean>,
  save: () => Promise<void>,
  reset: () => void,
): UnsavedGuard {
  const [blocked, setBlocked] = createSignal<BeforeLeaveEventArgs | null>(null);

  useBeforeLeave((e) => {
    // defaultPrevented means another handler already blocked this navigation.
    // Defensive only: router 0.16 hands each listener a snapshot, so the flag
    // does not actually propagate between listeners.
    if (!dirty() || e.defaultPrevented) return;
    e.preventDefault();
    setBlocked(e);
  });

  // Router navigation is only half the story — tab close and reload bypass it
  // entirely. The browser shows its own generic prompt; it cannot be
  // customized, but it is the difference between losing edits and not.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!dirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));

  // force=true skips re-running the leave handlers, which would otherwise
  // re-open the dialog on the retried navigation.
  const proceed = (e: BeforeLeaveEventArgs) => {
    setBlocked(null);
    e.retry(true);
  };

  return {
    pending: () => blocked() !== null,
    saveAndContinue: async () => {
      const e = blocked();
      if (!e) return;
      // If save() rejects, the error propagates and `blocked` stays set, so the
      // dialog remains open and the navigation does not happen. Losing edits to
      // a failed save is the exact thing this guard exists to prevent.
      await save();
      proceed(e);
    },
    discardAndContinue: () => {
      const e = blocked();
      if (!e) return;
      reset();
      proceed(e);
    },
    stay: () => setBlocked(null),
  };
}
