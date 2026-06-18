import { json } from "../server";
import type { Route } from "../server";

export type HealthDeps = {
  dockerReachable: () => Promise<boolean>;
};

export function healthRoutes(deps: HealthDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/health$/,
      handler: async (ctx) => {
        const docker = await deps.dockerReachable().catch(() => false);
        return json({
          ok: true,
          scannerLastRunAt: ctx.loop.lastTickAt(),
          dockerReachable: docker,
        });
      },
    },
  ];
}
