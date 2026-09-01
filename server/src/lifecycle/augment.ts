// server/src/lifecycle/augment.ts
import type { Snapshot } from "../scanner/types";
import type { ForestConfig } from "./config";
import { computeLifecycle } from "./status";

export type AugmentInput = {
  enabled: boolean;
  config: ForestConfig | null;
  /** Runs the health command; only called when enabled + config.health + servicesUp. */
  runHealth: () => Promise<{ exitCode: number }>;
};

function servicesUp(snap: Snapshot): boolean {
  return snap.services.docker.some((d) => d.state === "running") || snap.services.processes.length > 0;
}

/**
 * Fold a lifecycle status into `snap`. Health runs only when the project is
 * enabled, its config declares a `health` command, and services are already up —
 * so a discovered-but-not-enabled repo never executes anything.
 */
export async function augmentWithLifecycle(snap: Snapshot, input: AugmentInput): Promise<Snapshot> {
  const hasConfig = input.config !== null;
  const up = servicesUp(snap);
  let health: { exitCode: number } | null = null;

  if (input.enabled && hasConfig && input.config!.health && up) {
    health = await input.runHealth();
  }

  snap.lifecycle = {
    status: computeLifecycle({ enabled: input.enabled, hasConfig, servicesUp: up, health }),
    hasConfig,
    enabled: input.enabled,
    health,
  };
  return snap;
}
