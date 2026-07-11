import { stat } from "node:fs/promises";
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById } from "../store/projects";
import { defaultRunGit, gitLog, gitDiffPath, gitShowCommit, gitBranches, type RunGit } from "../git";
import { resolveProjectPath } from "../files/path";
import { imageMimeFor } from "./files";

export type ProjectGitDeps = {
  runGit?: RunGit;
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

async function isGitRepo(cwd: string, run: RunGit): Promise<boolean> {
  const r = await run(["rev-parse", "--git-dir"], cwd);
  return r.code === 0;
}

export function projectGitRoutes(deps: ProjectGitDeps = {}): Route[] {
  const run = deps.runGit ?? defaultRunGit;
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/git\/log$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!(await isGitRepo(project.path, run))) {
          return json({ error: "not a git repo" }, { status: 404 });
        }
        const limitRaw = ctx.url.searchParams.get("limit");
        const before = ctx.url.searchParams.get("before") ?? undefined;
        const ref = ctx.url.searchParams.get("ref") ?? undefined;
        let limit = DEFAULT_LIMIT;
        if (limitRaw !== null) {
          const n = parseInt(limitRaw, 10);
          if (!Number.isFinite(n) || n <= 0) return badRequest("invalid limit");
          limit = Math.min(n, MAX_LIMIT);
        }
        if (ref !== undefined) {
          const v = await run(["rev-parse", "--verify", "--quiet", ref], project.path);
          if (v.code !== 0) return badRequest("invalid ref");
        }
        try {
          const { commits, hasMore } = await gitLog(project.path, { limit, before, ref }, run);
          return json({ commits, hasMore });
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/git\/branches$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!(await isGitRepo(project.path, run))) {
          return json({ error: "not a git repo" }, { status: 404 });
        }
        try {
          const result = await gitBranches(project.path, run);
          return json(result);
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/git\/diff$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const rel = ctx.url.searchParams.get("path");
        if (!rel) return badRequest("missing path");
        const abs = resolveProjectPath(project.path, rel);
        if (!abs) return badRequest("invalid path");
        if (!(await isGitRepo(project.path, run))) {
          return json({ error: "not a git repo" }, { status: 404 });
        }
        try {
          const result = await gitDiffPath(project.path, rel, abs, run);
          let mtimeMs: number | null = null;
          try {
            mtimeMs = (await stat(abs)).mtimeMs;
          } catch {
            mtimeMs = null; // deleted in the working tree
          }
          return json({
            path: rel,
            diff: result.diff,
            status: result.status,
            image: imageMimeFor(rel),
            mtimeMs,
          });
        } catch (err) {
          return json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/git\/blob$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const rel = ctx.url.searchParams.get("path");
        if (!rel) return badRequest("missing path");
        const abs = resolveProjectPath(project.path, rel);
        if (!abs) return badRequest("invalid path");
        if (!(await isGitRepo(project.path, run))) {
          return json({ error: "not a git repo" }, { status: 404 });
        }
        const ref = ctx.url.searchParams.get("ref") ?? "HEAD";
        const verified = await run(["rev-parse", "--verify", "--quiet", ref], project.path);
        if (verified.code !== 0) return badRequest("invalid ref");
        // Blob existence check — cat-file -e produces no stdout, so routing it
        // through `run` (UTF-8) is safe. git uses forward slashes in tree paths.
        const exists = await run(["cat-file", "-e", `${ref}:${rel}`], project.path);
        if (exists.code !== 0) return notFound();
        // Stream the raw bytes with Bun.spawn — NOT `run`, which would decode
        // stdout as UTF-8 and corrupt binary content. Same SVG hardening as
        // the /file/raw route.
        const proc = Bun.spawn(["git", "show", `${ref}:${rel}`], { cwd: project.path });
        return new Response(proc.stdout, {
          headers: {
            "content-type": imageMimeFor(rel) ?? "application/octet-stream",
            "x-content-type-options": "nosniff",
            "content-security-policy": "script-src 'none'; sandbox",
          },
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/git\/commit$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const sha = ctx.url.searchParams.get("sha");
        if (!sha) return badRequest("missing sha");
        if (!(await isGitRepo(project.path, run))) {
          return json({ error: "not a git repo" }, { status: 404 });
        }
        try {
          const detail = await gitShowCommit(project.path, sha, run);
          return json(detail);
        } catch (err) {
          const e = err as Error & { kind?: string };
          if (e.kind === "not-found") {
            return json({ error: "not found" }, { status: 404 });
          }
          return json({ error: e.message }, { status: 500 });
        }
      },
    },
  ];
}
