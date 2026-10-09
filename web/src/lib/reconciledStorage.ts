import type { Signal } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";

/**
 * Resource storage that reconciles each fetch into the previous value, keyed by
 * `id`, instead of replacing it. A plain resource hands every poll brand-new
 * project objects, so every <For> over them tears down and rebuilds each card's
 * DOM every 5 seconds. A click whose mousedown and mouseup straddle that
 * rebuild lands on two different elements and never fires — links still
 * underline on hover (the fresh copy is under the cursor) but clicking them
 * does nothing, and open card menus snap shut.
 */
export function reconciledStorage<T>(value: T | undefined): Signal<T | undefined> {
  const [store, setStore] = createStore({ value });
  return [
    () => store.value,
    (v: unknown) => {
      const next = typeof v === "function" ? v(unwrap(store).value) : v;
      setStore("value", reconcile(next as T));
      return store.value;
    },
  ] as Signal<T | undefined>;
}
