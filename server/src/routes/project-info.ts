import { json, notFound } from "../server";
import type { Route } from "../server";
import { getProjectById } from "../store/projects";
import type { ProcessDetail } from "../scanner/processes";
import type { ContainerDetail } from "../scanner/docker";

export type ProjectInfoDeps = {
  processes: (path: string) => Promise<ProcessDetail[]>;
  containers: (path: string) => Promise<ContainerDetail[]>;
};

export function projectInfoRoutes(deps: ProjectInfoDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/processes$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const items = await deps.processes(project.path);
        return json(items);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/containers$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const items = await deps.containers(project.path);
        return json(items);
      },
    },
  ];
}
