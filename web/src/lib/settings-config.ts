import { createContext, useContext, type Resource } from "solid-js";

export type LauncherEntry = {
  id: string;
  label: string;
  command: string | null;
  args: string[];
  agent?: string;
};

export type ServerConfig = {
  scanRoot: string | null;
  pollIntervalMs: number;
  sessionMaxTotal?: number;
  sessionMaxScrollbackLines?: number;
  sessionDefaultShell?: string;
  projectSubdirs?: string[];
  launchers?: LauncherEntry[];
  claudeConfigDirs?: Array<{ path: string; profile: string }>;
};

export type SettingsConfig = {
  config: Resource<ServerConfig>;
  refetch: () => void;
};

export const SettingsConfigContext = createContext<SettingsConfig>();

export function useSettingsConfig(): SettingsConfig {
  const ctx = useContext(SettingsConfigContext);
  if (!ctx) throw new Error("useSettingsConfig used outside SettingsConfigContext");
  return ctx;
}
