import type { Database } from "bun:sqlite";
import type { ServerWebSocket } from "bun";
import type { Loop } from "./loop";
import type { Level } from "./log";
import type { SessionRegistry } from "./sessions/registry";
import type { AttachData } from "./sessions/types";
import { attach, handleClientFrame, detach } from "./sessions/attach";

type Logger = (level: Level, msg: string, meta?: Record<string, unknown>) => void;

export type RouteCtx = {
  db: Database;
  loop: Loop;
  log: Logger;
  url: URL;
  params: Record<string, string>;
  request: Request;
};

export type Route = {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  pattern: RegExp;
  handler: (ctx: RouteCtx) => Promise<Response> | Response;
  paramNames?: string[];
};

export type ServerDeps = {
  port: number;
  db: Database;
  loop: Loop;
  log: Logger;
  routes: Route[];
  staticDir?: string;
  sessions?: SessionRegistry;
};

const WS_PATTERN = /^\/ws\/projects\/([^/]+)\/sessions\/([^/]+)$/;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function notFound(): Response {
  return json({ error: "not found" }, { status: 404 });
}

export function badRequest(error: string): Response {
  return json({ error }, { status: 400 });
}

function cacheHeadersFor(pathname: string): HeadersInit {
  // Hashed Vite assets under /assets/ are content-addressed — safe to cache forever.
  if (pathname.startsWith("/assets/")) {
    return { "cache-control": "public, max-age=31536000, immutable" };
  }
  // index.html and SPA fallback must revalidate so new builds are picked up immediately.
  return { "cache-control": "no-cache" };
}

export function startServer(deps: ServerDeps) {
  const { port, routes, staticDir, db, loop, log, sessions } = deps;

  return Bun.serve<AttachData>({
    port,
    async fetch(request, server) {
      const url = new URL(request.url);

      if (sessions && request.method === "GET") {
        const m = url.pathname.match(WS_PATTERN);
        if (m) {
          const upgraded = server.upgrade(request, {
            data: { projectId: m[1]!, sessionId: m[2]! },
          });
          if (upgraded) return undefined as unknown as Response;
          return new Response("upgrade required", { status: 426 });
        }
      }

      for (const r of routes) {
        if (r.method !== request.method) continue;
        const m = url.pathname.match(r.pattern);
        if (!m) continue;
        const params: Record<string, string> = {};
        (r.paramNames ?? []).forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1] ?? "");
        });
        try {
          return await r.handler({ db, loop, log, url, params, request });
        } catch (err) {
          log("error", "route handler threw", { path: url.pathname, error: (err as Error).message });
          return json({ error: "internal" }, { status: 500 });
        }
      }

      if (staticDir && request.method === "GET") {
        const file = Bun.file(`${staticDir}${url.pathname === "/" ? "/index.html" : url.pathname}`);
        if (await file.exists()) return new Response(file, { headers: cacheHeadersFor(url.pathname) });
        const fallback = Bun.file(`${staticDir}/index.html`);
        if (await fallback.exists()) return new Response(fallback, { headers: cacheHeadersFor("/index.html") });
      }
      return notFound();
    },
    websocket: sessions
      ? {
          open(ws: ServerWebSocket<AttachData>) {
            log("info", "session.attach", { projectId: ws.data.projectId, sessionId: ws.data.sessionId });
            attach(ws as never, sessions);
          },
          message(ws: ServerWebSocket<AttachData>, raw) {
            if (typeof raw !== "string") return;
            handleClientFrame(ws as never, raw, sessions);
          },
          close(ws: ServerWebSocket<AttachData>) {
            log("info", "session.detach", { projectId: ws.data.projectId, sessionId: ws.data.sessionId });
            detach(ws as never, sessions);
          },
        }
      : {
          message() {},
        },
  });
}

export { json };
