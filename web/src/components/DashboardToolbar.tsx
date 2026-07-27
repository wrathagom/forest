import { For } from "solid-js";
import type { Theme } from "../lib/themes/types";
import { COLOR_BY_DIMENSIONS, legend, type ColorByDimension } from "../lib/colorBy";
import { VIEW_PRESETS } from "../lib/dashboard-view";
import type { ProjectSort } from "../lib/project-list";
import {
  dashboardColorBy, setDashboardColorBy,
  dashboardPreset, setDashboardPreset,
  dashboardSort, setDashboardSort,
} from "../lib/preferences";

export default function DashboardToolbar(props: {
  query: string;
  onQuery: (q: string) => void;
  groups: string[];
  theme: Theme;
}) {
  return (
    <div class="dashboard-toolbar">
      <input
        class="search-input"
        type="search"
        placeholder="search projects…"
        value={props.query}
        oninput={(e) => props.onQuery(e.currentTarget.value)}
      />
      <select
        class="sort-select"
        value={dashboardSort()}
        onchange={(e) => setDashboardSort(e.currentTarget.value as ProjectSort)}
      >
        <option value="recent">recent</option>
        <option value="running">running</option>
        <option value="name">name</option>
      </select>

      <div class="preset-group" role="group" aria-label="card detail">
        <For each={VIEW_PRESETS}>
          {(p) => (
            <button
              class={`preset-btn${dashboardPreset() === p ? " active" : ""}`}
              onclick={() => setDashboardPreset(p)}
            >
              {p}
            </button>
          )}
        </For>
      </div>

      <select
        class="colorby-select"
        aria-label="color by"
        value={dashboardColorBy()}
        onchange={(e) => setDashboardColorBy(e.currentTarget.value as ColorByDimension)}
      >
        <For each={COLOR_BY_DIMENSIONS}>
          {(d) => <option value={d}>color: {d}</option>}
        </For>
      </select>

      <div class="legend">
        <For each={legend(dashboardColorBy(), props.groups, props.theme)}>
          {(e) => (
            <span class="legend-entry">
              <span class="legend-swatch" style={{ background: e.swatch }} />
              {e.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
