import { basename } from "node:path";
import { json } from "../server";
import type { Route } from "../server";
import { getScanRoot } from "../store/config";
import { upsertProject } from "../store/projects";
import { expandHome } from "../paths";
import { inferGroup } from "../discovery";

export type DiscoverDeps = {
  runDiscover: (root: string) => Promise<string[]>;
};

export function discoverRoutes(deps: DiscoverDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/discover$/,
      handler: async (ctx) => {
        const root = getScanRoot(ctx.db);
        if (!root) return json({ ok: false, error: "scanRoot not set" }, { status: 400 });
        const expanded = expandHome(root);
        const paths = await deps.runDiscover(expanded);
        for (const p of paths) {
          upsertProject(ctx.db, {
            path: p,
            name: basename(p),
            group: inferGroup(expanded, p),
          });
        }
        return json({ ok: true, root: expanded, count: paths.length });
      },
    },
  ];
}
