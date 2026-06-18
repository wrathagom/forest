import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { json, badRequest } from "../server";
import type { Route } from "../server";
import { getScanRoot, getProjectSubdirs } from "../store/config";
import { upsertProject, getProjectByPath, getProjectById } from "../store/projects";
import { gitInit, gitCommit, gitClone, defaultRunGit, type RunGit } from "../git";

const NAME_RE = /^[A-Za-z0-9._-]+$/;

export type ProjectCreateDeps = {
  runGit?: RunGit;
};

type Body =
  | { name?: string; subdir?: string; source?: { type: "blank" } | { type: "clone"; url: string } };

export function projectCreateRoutes(deps: ProjectCreateDeps = {}): Route[] {
  const run = deps.runGit ?? defaultRunGit;
  return [
    {
      method: "POST",
      pattern: /^\/api\/projects$/,
      handler: async (ctx) => {
        const body = (await ctx.request.json().catch(() => null)) as Body | null;
        if (!body) return badRequest("invalid JSON");
        const name = (body.name ?? "").trim();
        const subdir = (body.subdir ?? "").trim();
        const source = body.source;

        if (!NAME_RE.test(name) || name === "." || name === "..") return badRequest("invalid project name");
        if (!source || (source.type !== "blank" && source.type !== "clone")) return badRequest("invalid source");
        if (source.type === "clone" && !source.url.trim()) return badRequest("clone url is required");

        const scanRoot = getScanRoot(ctx.db);
        if (!scanRoot) return json({ error: "scanRoot not set" }, { status: 503 });

        if (subdir !== "") {
          const allowed = getProjectSubdirs(ctx.db);
          if (!allowed.includes(subdir)) return badRequest(`unknown subdir: ${subdir}`);
        }

        const dest = subdir === "" ? join(scanRoot, name) : join(scanRoot, subdir, name);
        if (existsSync(dest)) return badRequest(`destination already exists: ${dest}`);
        if (getProjectByPath(ctx.db, dest)) return badRequest(`a project already exists at this path`);

        let createdDir = false;
        try {
          if (source.type === "clone") {
            mkdirSync(dirname(dest), { recursive: true });
            await gitClone(source.url.trim(), dest, run);
            createdDir = true;
          } else {
            mkdirSync(dest, { recursive: true });
            createdDir = true;
            await gitInit(dest, run);
            writeFileSync(join(dest, "README.md"), `# ${name}\n`);
            await gitCommit(dest, "initial commit", ["README.md"], run);
          }
        } catch (err) {
          if (createdDir) rmSync(dest, { recursive: true, force: true });
          return badRequest(`create failed: ${(err as Error).message}`);
        }

        const id = upsertProject(ctx.db, {
          path: dest,
          name,
          group: subdir === "" ? null : subdir,
        });
        const project = getProjectById(ctx.db, id);
        return json({ project });
      },
    },
  ];
}
