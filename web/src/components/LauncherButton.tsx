import { For, Show, createSignal, onCleanup } from "solid-js";

export type LauncherEntry = {
  id: string;
  label: string;
  command: string | null;
  args: string[];
  agent?: string;
};

export default function LauncherButton(props: {
  launchers: LauncherEntry[];
  lastUsedId: string | null;
  onLaunch: (entry: LauncherEntry) => void;
  onChangeLastUsed: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const primary = () =>
    props.launchers.find((l) => l.id === props.lastUsedId) ?? props.launchers[0];

  let rootRef: HTMLDivElement | undefined;
  const onDocClick = (e: MouseEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("click", onDocClick);
  onCleanup(() => document.removeEventListener("click", onDocClick));

  return (
    <div class="launcher" ref={rootRef}>
      <Show when={primary()}>
        {(p) => (
          <button
            class="launcher-primary"
            title={`new terminal: ${p().label}`}
            onclick={() => props.onLaunch(p())}
          >
            +
          </button>
        )}
      </Show>
      <button class="launcher-chevron" title="choose launcher" onclick={() => setOpen(!open())}>▾</button>
      <Show when={open()}>
        <div class="launcher-menu">
          <For each={props.launchers}>
            {(l) => (
              <button
                class="launcher-menu-item"
                onclick={() => {
                  props.onChangeLastUsed(l.id);
                  props.onLaunch(l);
                  setOpen(false);
                }}
              >
                {l.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
