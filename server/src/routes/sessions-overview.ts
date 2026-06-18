import { json } from "../server";
import type { Route } from "../server";
import type { Vault, SessionListSort } from "../sessions/vault";

export type SessionsOverviewDeps = { vault: Vault };

const VALID_SORTS: ReadonlySet<string> = new Set([
  "last_activity",
  "started_at",
  "tokens",
  "message_count",
  "project",
]);

function intParam(value: string | null, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function sessionsOverviewRoutes(deps: SessionsOverviewDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/sessions$/,
      handler: (ctx) => {
        const sp = ctx.url.searchParams;
        const sortRaw = sp.get("sort") ?? "last_activity";
        const sort = (VALID_SORTS.has(sortRaw) ? sortRaw : "last_activity") as SessionListSort;
        const dir = sp.get("dir") === "asc" ? "asc" : "desc";
        const result = deps.vault.listAll({
          q: sp.get("q") ?? undefined,
          projectId: sp.get("project") ?? undefined,
          sort,
          dir,
          limit: intParam(sp.get("limit"), 50),
          offset: intParam(sp.get("offset"), 0),
        });
        return json(result);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/sessions\/stats$/,
      handler: () => {
        const tokensByProject = deps.vault.tokensByProject();
        const tokensOverTime = deps.vault.tokensOverTime({ days: 30 });
        const totals = tokensByProject.reduce(
          (acc, p) => ({
            sessions: acc.sessions + p.sessions,
            input: acc.input + p.input,
            output: acc.output + p.output,
            cache: acc.cache + p.cache,
          }),
          { sessions: 0, input: 0, output: 0, cache: 0 },
        );
        return json({ tokensOverTime, tokensByProject, totals });
      },
    },
  ];
}
