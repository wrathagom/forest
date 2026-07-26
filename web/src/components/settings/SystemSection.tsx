import { For, Show } from "solid-js";
import { useSettingsConfig } from "../../lib/settings-config";

// Read-only, so there is no save button and no unsaved-changes guard.
export default function SystemSection() {
  const { config } = useSettingsConfig();
  const dirs = () => config()?.claudeConfigDirs ?? [];

  return (
    <section>
      <h3>system</h3>
      <span class="hint">
        detected automatically - Forest scans transcripts and installs hooks into each
      </span>
      <Show
        when={dirs().length > 0}
        fallback={<div class="muted" style={{ padding: "0.3rem 0" }}>no claude config dirs detected</div>}
      >
        <ul class="config-dirs-list">
          <For each={dirs()}>
            {(d) => (
              <li>
                <span class="config-dir-profile">{d.profile}</span> <code>{d.path}</code>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
