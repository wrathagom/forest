import { existsSync, statSync } from "node:fs";
import { json, badRequest } from "../server";
import type { Route } from "../server";
import {
  getScanRoot, setScanRoot,
  getPollIntervalMs, setPollIntervalMs,
  getSessionMaxTotal, setSessionMaxTotal,
  getSessionMaxScrollbackLines, setSessionMaxScrollbackLines,
  getSessionDefaultShell, setSessionDefaultShell,
  getProjectSubdirs, setProjectSubdirs,
  getLaunchers, setLaunchers,
  type LauncherEntry,
} from "../store/config";
import { expandHome } from "../paths";
import type { ClaudeConfigDir } from "../sessions/config-dirs";

export type ConfigRouteDeps = { claudeConfigDirs: () => ClaudeConfigDir[] };

export function configRoutes(deps: ConfigRouteDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/config$/,
      handler: (ctx) => json({
        scanRoot: getScanRoot(ctx.db) ?? null,
        pollIntervalMs: getPollIntervalMs(ctx.db),
        sessionMaxTotal: getSessionMaxTotal(ctx.db),
        sessionMaxScrollbackLines: getSessionMaxScrollbackLines(ctx.db),
        sessionDefaultShell: getSessionDefaultShell(ctx.db),
        projectSubdirs: getProjectSubdirs(ctx.db),
        launchers: getLaunchers(ctx.db),
        claudeConfigDirs: deps.claudeConfigDirs(),
      }),
    },
    {
      method: "PATCH",
      pattern: /^\/api\/config$/,
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as
          | {
              scanRoot?: string;
              pollIntervalMs?: number;
              sessionMaxTotal?: number;
              sessionMaxScrollbackLines?: number;
              sessionDefaultShell?: string;
              projectSubdirs?: string[];
              launchers?: LauncherEntry[];
            }
          | null;
        if (!body) return badRequest("invalid JSON");
        if (typeof body.scanRoot === "string") {
          const expanded = expandHome(body.scanRoot.trim());
          if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
            return badRequest(`scanRoot does not exist or is not a directory: ${expanded}`);
          }
          setScanRoot(ctx.db, expanded);
        }
        if (typeof body.pollIntervalMs === "number") setPollIntervalMs(ctx.db, body.pollIntervalMs);
        if (typeof body.sessionMaxTotal === "number") setSessionMaxTotal(ctx.db, body.sessionMaxTotal);
        if (typeof body.sessionMaxScrollbackLines === "number") setSessionMaxScrollbackLines(ctx.db, body.sessionMaxScrollbackLines);
        if (typeof body.sessionDefaultShell === "string") setSessionDefaultShell(ctx.db, body.sessionDefaultShell);
        if (Array.isArray(body.projectSubdirs)) setProjectSubdirs(ctx.db, body.projectSubdirs);
        if (Array.isArray(body.launchers)) setLaunchers(ctx.db, body.launchers);
        return json({ ok: true });
      },
    },
  ];
}
