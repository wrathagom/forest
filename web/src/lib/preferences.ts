import { persistedSignal } from "./persisted";
import type { ProjectSort } from "./project-list";
import type { ViewPreset } from "./dashboard-view";
import type { ColorByDimension } from "./colorBy";

// App-wide UI preferences. Anything that should be a "Settings"-controlled
// pref but doesn't need to live on the server lands here as a shared signal.
// Importing the same export twice is fine — modules are evaluated once, so
// every consumer sees the same signal instance.

export const [autoRefresh, setAutoRefresh] = persistedSignal("dashboard.autoRefresh", true);

export const [dashboardSort, setDashboardSort] = persistedSignal<ProjectSort>(
  "dashboard.sort",
  "recent",
);

export const [dashboardPreset, setDashboardPreset] = persistedSignal<ViewPreset>(
  "dashboard.preset",
  "status",
);

export const [dashboardColorBy, setDashboardColorBy] = persistedSignal<ColorByDimension>(
  "dashboard.colorBy",
  "git",
);
