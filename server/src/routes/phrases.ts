import { json, badRequest } from "../server";
import type { Route } from "../server";
import type { PhraseStore } from "../phrases/store";
import type { PhraseIndexBuilder } from "../phrases/builder";
import { AGENT } from "../phrases/builder";

export type PhrasesDeps = { store: PhraseStore; builder: PhraseIndexBuilder };

function intParam(value: string | null, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function phrasesRoutes(deps: PhrasesDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/phrases$/,
      handler: (ctx) => {
        const sp = ctx.url.searchParams;
        const n = Math.min(Math.max(intParam(sp.get("n"), 3), 2), 5);
        const sort = sp.get("sort") === "trending" ? "trending" : "count";
        const limit = Math.min(Math.max(intParam(sp.get("limit"), 100), 1), 200);
        const offset = Math.max(intParam(sp.get("offset"), 0), 0);
        return json(
          deps.store.leaderboard({
            agent: AGENT,
            n,
            from: sp.get("from") ?? undefined,
            to: sp.get("to") ?? undefined,
            sort,
            limit,
            offset,
          }),
        );
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/phrases\/occurrences$/,
      handler: (ctx) => {
        const sp = ctx.url.searchParams;
        const phrase = (sp.get("phrase") ?? "").trim();
        if (!phrase) return badRequest("phrase required");
        const limit = Math.min(Math.max(intParam(sp.get("limit"), 50), 1), 200);
        const offset = Math.max(intParam(sp.get("offset"), 0), 0);
        return json({ occurrences: deps.store.occurrences({ phrase, agent: AGENT, limit, offset }) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/phrases\/status$/,
      handler: () => json(deps.builder.status()),
    },
    {
      method: "POST",
      pattern: /^\/api\/phrases\/rebuild$/,
      handler: () => {
        void deps.builder.rebuild(); // fire-and-forget; status reflects `building`
        return json(deps.builder.status());
      },
    },
  ];
}
