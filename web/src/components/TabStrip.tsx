import { For, Show } from "solid-js";
import type { Tab } from "../lib/tabs";
import LauncherButton, { type LauncherEntry } from "./LauncherButton";

export default function TabStrip(props: {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onLaunch: (entry: LauncherEntry) => void;
  launchers: LauncherEntry[];
  lastUsedLauncher: string | null;
  onChangeLastUsedLauncher: (id: string) => void;
  infoExpanded?: () => boolean;
  onToggleInfo?: () => void;
}) {
  const handleClose = (e: MouseEvent, t: Tab) => {
    e.stopPropagation();
    if (t.kind === "file" && t.dirty) {
      const ok = confirm(`${t.label} has unsaved changes — discard?`);
      if (!ok) return;
    }
    props.onClose(t.id);
  };
  return (
    <div class="tab-strip">
      <For each={props.tabs}>
        {(t) => (
          <div
            class={`tab tab-${t.kind} ${props.activeId === t.id ? "active" : ""} ${
              t.kind === "file" && t.dirty ? "dirty" : ""
            }`}
            title={t.kind === "terminal" && t.agent ? t.agent : undefined}
            onclick={() => props.onSelect(t.id)}
          >
            <span class="tab-label">
              {t.kind === "file" && t.dirty ? "● " : ""}
              {t.kind === "terminal" && t.agent ? "🤖 " : ""}
              {t.label}
            </span>
            <button class="tab-kill" title="close" onclick={(e) => handleClose(e, t)}>
              ×
            </button>
          </div>
        )}
      </For>
      <LauncherButton
        launchers={props.launchers}
        lastUsedId={props.lastUsedLauncher}
        onLaunch={props.onLaunch}
        onChangeLastUsed={props.onChangeLastUsedLauncher}
      />
      <Show when={props.onToggleInfo}>
        <button
          class="info-toggle"
          onclick={() => props.onToggleInfo!()}
          title={props.infoExpanded?.() ? "hide info pane" : "show info pane"}
        >
          {props.infoExpanded?.() ? "‹ hide" : "› info"}
        </button>
      </Show>
    </div>
  );
}
