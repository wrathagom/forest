import { createResource } from "solid-js";
import { A, type RouteSectionProps } from "@solidjs/router";
import { fetchConfig } from "../api";
import { SettingsConfigContext, type ServerConfig } from "../lib/settings-config";

const SECTIONS = [
  { path: "appearance", label: "appearance" },
  { path: "dashboard", label: "dashboard" },
  { path: "scan", label: "scan" },
  { path: "terminals", label: "terminals" },
  { path: "launchers", label: "launchers" },
  { path: "integrations", label: "integrations" },
  { path: "system", label: "system" },
] as const;

export default function Settings(props: RouteSectionProps) {
  const [config, { refetch }] = createResource<ServerConfig>(fetchConfig);

  return (
    <div class="settings page">
      <h2>settings</h2>
      <SettingsConfigContext.Provider value={{ config, refetch }}>
        <div class="settings-shell">
          <nav class="settings-rail">
            {SECTIONS.map((s) => (
              <A href={`/settings/${s.path}`} activeClass="active">{s.label}</A>
            ))}
          </nav>
          <div class="settings-pane">{props.children}</div>
        </div>
      </SettingsConfigContext.Provider>
    </div>
  );
}
