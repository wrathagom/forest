import { json, badRequest } from "../server";
import type { Route } from "../server";
import type { Controller } from "../caffeinate";

const ALLOWED_DURATIONS_SEC = new Set([3600, 7200, 14400, 28800]);

export function caffeinateRoutes(controller: Controller): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/caffeinate$/,
      handler: () => json(controller.status()),
    },
    {
      method: "POST",
      pattern: /^\/api\/caffeinate$/,
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as { durationSec?: unknown } | null;
        if (!body || !("durationSec" in body)) return badRequest("missing durationSec");
        const d = body.durationSec;
        if (d !== null && (typeof d !== "number" || !ALLOWED_DURATIONS_SEC.has(d))) {
          return badRequest("durationSec must be null or one of 3600, 7200, 14400, 28800");
        }
        if (!controller.status().supported) {
          return badRequest("caffeinate is not supported on this platform");
        }
        try {
          return json(controller.start(d as number | null));
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/caffeinate$/,
      handler: () => json(controller.stop()),
    },
  ];
}
