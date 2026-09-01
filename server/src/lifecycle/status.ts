// server/src/lifecycle/status.ts

/** Steady-state statuses (transient starting/stopping come from the registry). */
export type LifecycleStatus =
  | "none"      // not enabled, or no forest.yaml
  | "stopped"   // enabled, nothing up
  | "running"   // enabled, up, no health command / health not run
  | "healthy"   // enabled, up, health exit 0
  | "errors"    // enabled, up, health exit nonzero
  | "starting"  // registry-owned
  | "stopping"; // registry-owned

export type LifecycleInput = {
  enabled: boolean;
  hasConfig: boolean;
  servicesUp: boolean;
  health: { exitCode: number } | null;
};

/** Pure: maps enabled/hasConfig/servicesUp/health to a steady-state status. */
export function computeLifecycle(input: LifecycleInput): LifecycleStatus {
  if (!input.enabled || !input.hasConfig) return "none";
  if (!input.servicesUp) return "stopped";
  if (input.health === null) return "running";
  return input.health.exitCode === 0 ? "healthy" : "errors";
}
