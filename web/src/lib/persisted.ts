import { createSignal, createEffect, type Accessor, type Setter } from "solid-js";

const PREFIX = "forest.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // private mode / quota / disabled — silently fall through
  }
}

export function persistedSignal<T>(key: string, fallback: T): [Accessor<T>, Setter<T>] {
  const [val, setVal] = createSignal<T>(read(key, fallback));

  const persistingSet: Setter<T> = ((updater?: T | ((prev: T) => T)) => {
    // @ts-expect-error — forward the raw argument so both value and function forms work
    const next = setVal(updater);
    write(key, next);
    return next;
  }) as Setter<T>;

  return [val, persistingSet];
}
