import { json, badRequest } from "../server";
import type { Route } from "../server";
import { getBbsConfig, setBbsConfig, maskKey, type BbsConfigInput } from "../store/config";
import type { BbsClient } from "../bbs/client";
import type { BbsPublisher } from "../bbs/publisher";

export type BbsRouteDeps = {
  client: Pick<BbsClient, "screenExists" | "createScreen" | "updateScreen">;
  publisher: Pick<BbsPublisher, "status" | "sendTest">;
};

export function bbsRoutes(deps: BbsRouteDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/bbs\/config$/,
      handler: (ctx) => {
        const c = getBbsConfig(ctx.db);
        return json({
          enabled: c.enabled,
          baseUrl: c.baseUrl,
          screenId: c.screenId,
          screenUrl: c.screenId ? `${c.baseUrl}/screen/${c.screenId}` : null,
          accountKey: maskKey(c.accountKey),
          screenKey: maskKey(c.screenKey),
          alertLingerSec: c.alertLingerSec,
          hudIntervalMs: c.hudIntervalMs,
          rotationIntervalSec: c.rotationIntervalSec,
          hudPanelCap: c.hudPanelCap,
          alertEvents: c.alertEvents,
          status: deps.publisher.status(),
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/bbs\/config$/,
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as BbsConfigInput | null;
        if (!body) return badRequest("invalid JSON");
        setBbsConfig(ctx.db, body);
        return json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/bbs\/provision$/,
      handler: async (ctx) => {
        const c = getBbsConfig(ctx.db);
        if (!c.accountKey) return badRequest("set a BBS account key first");
        let screenId = c.screenId;
        let screenKey = c.screenKey;
        const reuse = screenId && screenKey && (await deps.client.screenExists(c.accountKey, screenId));
        if (!reuse) {
          const created = await deps.client.createScreen(c.accountKey, "Forest HUD");
          screenId = created.screen_id;
          screenKey = created.api_key;
          setBbsConfig(ctx.db, { screenId, screenKey });
        }
        await deps.client.updateScreen(screenKey!, screenId!, {
          rotation_enabled: true,
          rotation_interval: c.rotationIntervalSec,
        });
        return json({ ok: true, screenId, screenUrl: `${c.baseUrl}/screen/${screenId}` });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/bbs\/test$/,
      handler: async () => {
        try {
          await deps.publisher.sendTest();
          return json({ ok: true });
        } catch (err) {
          return badRequest((err as Error).message);
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/bbs\/status$/,
      handler: () => json(deps.publisher.status()),
    },
  ];
}
