import { json, badRequest, notFound } from "../server";
import type { Route } from "../server";
import type { AgentRunner, PermissionMode } from "../sessions/runner";
import { PERMISSION_MODES } from "../sessions/runner";
import type { Vault, SessionRow } from "../sessions/vault";
import type { LiveAgentSessions, LiveEntry } from "../sessions/live";

export type MobileRoutesDeps = {
  runner: AgentRunner;
  vault: Vault;
  liveSessions: LiveAgentSessions;
  listProjects: () => Array<{ id: string; path: string }>;
  projectName: (id: string) => string | null;
};

export type MobileListItem = {
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  label: string;
  snippet: string | null;
  state: "working" | "waiting" | "done";
  lastActivity: number;
  launchedVia: "mobile" | null;
  forestActionable: boolean;
};

const NEEDS_YOU_MOBILE_WINDOW_MS = 6 * 3600_000;
const isMobile = (v: unknown): v is "mobile" => v === "mobile";

export function mobileRoutes(deps: MobileRoutesDeps): Route[] {
  const fromLive = (e: LiveEntry, state: "working" | "waiting"): MobileListItem => ({
    sessionId: e.agentSessionId,
    projectId: e.projectId,
    projectName: e.projectName,
    label: e.lastUserMsg ?? e.agentSessionId.slice(0, 8),
    snippet: deps.vault.lastAssistantText(e.agentSessionId),
    state,
    lastActivity: e.lastEventAt,
    launchedVia: isMobile(e.launchedVia) ? "mobile" : null,
    forestActionable: !!e.ptySessionId || isMobile(e.launchedVia),
  });
  const fromVault = (s: SessionRow & { project_name: string | null }, state: "waiting" | "done"): MobileListItem => ({
    sessionId: s.session_id,
    projectId: s.project_id,
    projectName: s.project_name,
    label: s.first_user_msg ?? s.session_id.slice(0, 8),
    snippet: deps.vault.lastAssistantText(s.session_id),
    state,
    lastActivity: s.last_activity,
    launchedVia: isMobile(s.launched_via) ? "mobile" : null,
    forestActionable: true,
  });

  return [
    {
      method: "POST",
      pattern: /^\/api\/agent-runs$/,
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as
          | { projectId?: string; prompt?: string; permissionMode?: string } | null;
        if (!body || typeof body.projectId !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) {
          return badRequest("projectId and a non-empty prompt are required");
        }
        if (body.permissionMode === undefined) return badRequest("permissionMode is required");
        const mode = body.permissionMode;
        if (typeof mode !== "string" || !(PERMISSION_MODES as readonly string[]).includes(mode)) {
          return badRequest(`permissionMode must be one of: ${PERMISSION_MODES.join(", ")}`);
        }
        try {
          const out = await deps.runner.launch({ projectId: body.projectId, prompt: body.prompt, permissionMode: mode as PermissionMode });
          return json(out);
        } catch (err) {
          const msg = (err as Error).message;
          if (/unknown project/.test(msg)) return notFound();
          return badRequest(msg);
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agent-sessions\/([^/]+)\/reply$/,
      paramNames: ["sid"],
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as { text?: string } | null;
        if (!body || typeof body.text !== "string" || !body.text.trim()) return badRequest("text is required");
        try {
          await deps.runner.reply({ sessionId: ctx.params.sid!, text: body.text });
          return new Response(null, { status: 204 });
        } catch (err) {
          const msg = (err as Error).message;
          if (/unknown session/.test(msg)) return notFound();
          return badRequest(msg);
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agent-sessions\/([^/]+)\/done$/,
      paramNames: ["sid"],
      handler: (ctx) => {
        deps.liveSessions.dismiss(ctx.params.sid!);
        return new Response(null, { status: 204 });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/m\/sessions$/,
      handler: () => {
        const dismissed = (sid: string) => deps.liveSessions.isDismissed(sid);
        const live = deps.liveSessions.list(20).filter((e) => !dismissed(e.agentSessionId));
        const working = live.filter((e) => e.state === "working").map((e) => fromLive(e, "working"));
        const needsYouLive = live
          .filter((e) => e.state === "waiting" && (!!e.ptySessionId || isMobile(e.launchedVia)))
          .map((e) => fromLive(e, "waiting"));
        const seen = new Set<string>([...working, ...needsYouLive].map((i) => i.sessionId));
        const recentRows = deps.vault.recentSessions(20);
        const cutoff = Date.now() - NEEDS_YOU_MOBILE_WINDOW_MS;
        const needsYouMobile = recentRows
          .filter((s) => isMobile(s.launched_via) && s.last_activity > cutoff && !seen.has(s.session_id) && !dismissed(s.session_id))
          .slice(0, 10)
          .map((s) => fromVault(s, "waiting"));
        for (const i of needsYouMobile) seen.add(i.sessionId);
        const needsYou = [...needsYouLive, ...needsYouMobile];
        const recent = recentRows
          .filter((s) => !seen.has(s.session_id))
          .map((s) => fromVault(s, "done"))
          .sort((a, b) => (isMobile(b.launchedVia) ? 1 : 0) - (isMobile(a.launchedVia) ? 1 : 0) || b.lastActivity - a.lastActivity)
          .slice(0, 15);
        return json({ needsYou, working, recent });
      },
    },
  ];
}
