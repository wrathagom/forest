import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { Vault } from "../sessions/vault";
import { scanClaudeProjects, classifyCwd } from "../sessions/scanner";
import type { LiveAgentSessions } from "../sessions/live";
import type { ClaudeConfigDir } from "../sessions/config-dirs";

export type RouteDeps = {
  vault: Vault;
  listProjects: () => Array<{ id: string; path: string }>;
  claudeConfigDirs: () => ClaudeConfigDir[];
  liveSessions?: LiveAgentSessions;
  projectName?: (id: string) => string | null;
};

export function agentSessionsRoutes(deps: RouteDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/agent-sessions\/ingest$/,
      handler: async (ctx) => {
        const event = (ctx.request.headers.get("x-forest-event") ?? "unknown").toLowerCase();
        const ptyHint = ctx.request.headers.get("x-forest-pty") || null;
        const body = (await ctx.request.json().catch(() => null)) as
          | { session_id?: string; cwd?: string; transcript_path?: string; prompt?: string }
          | null;
        if (!body?.session_id || !body.transcript_path) {
          return badRequest("session_id and transcript_path are required");
        }
        const source =
          event === "precompact" ? "hook:precompact" : event === "sessionend" ? "hook:sessionend" : "scan";
        const projects = deps.listProjects();
        let sessionsTouched = 0;
        try {
          const scan = await scanClaudeProjects({
            db: ctx.db,
            vault: deps.vault,
            configDirs: deps.claudeConfigDirs(),
            projects,
            onlySessionIds: new Set([body.session_id]),
            source,
          });
          sessionsTouched = scan.sessionsTouched;
        } catch (err) {
          ctx.log("warn", "agent-sessions: ingest scan failed", { error: (err as Error).message });
        }
        // Enrich from the vault (it now holds this session's latest row, when the
        // transcript had parseable lines); fall back to the hook body + cwd classification.
        const sess = deps.vault.getSession(body.session_id);
        const cwd = body.cwd ?? sess?.cwd ?? "";
        const byCwd = classifyCwd(cwd, projects);
        const projectId = sess?.project_id ?? byCwd.projectId;
        deps.liveSessions?.applyHookEvent({
          agentSessionId: body.session_id,
          event,
          cwd,
          parentSessionId: sess?.parent_session_id ?? null,
          projectId,
          projectName: projectId ? deps.projectName?.(projectId) ?? null : null,
          worktreeLabel: sess?.worktree_label ?? byCwd.worktreeLabel,
          branch: sess?.branch ?? null,
          profile: sess?.profile ?? null,
          lastUserMsg: (event === "userpromptsubmit" ? body.prompt ?? null : null) ?? sess?.first_user_msg ?? null,
          ptySessionId: ptyHint,
          at: Date.now(),
          launchedVia: sess?.launched_via === "mobile" ? "mobile" : null,
        });
        return json({ ok: true, sessions: sessionsTouched });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/agent-sessions$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const limit = Math.min(parseInt(ctx.url.searchParams.get("limit") ?? "25", 10), 200);
        const offset = Math.max(parseInt(ctx.url.searchParams.get("offset") ?? "0", 10), 0);
        const q = ctx.url.searchParams.get("q");
        const sessions = q
          ? deps.vault.searchByProject(ctx.params.id!, q, limit)
          : deps.vault.listByProject(ctx.params.id!, limit, offset);
        return json({ sessions });
      },
    },
    {
      // IMPORTANT: must be registered before the /api/agent-sessions/:sid route
      // below — `live` would otherwise match `([^/]+)`.
      method: "GET",
      pattern: /^\/api\/agent-sessions\/live$/,
      // the session bar surfaces at most ~10 live sessions
      handler: () => json({ sessions: deps.liveSessions?.list(10) ?? [] }),
    },
    {
      method: "GET",
      pattern: /^\/api\/agent-sessions\/([^/]+)$/,
      paramNames: ["sid"],
      handler: (ctx) => {
        const detail = deps.vault.getSessionDetail(ctx.params.sid!);
        if (!detail) return notFound();
        return json(detail);
      },
    },
  ];
}
