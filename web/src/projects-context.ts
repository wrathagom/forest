import { createContext, useContext, type Resource } from "solid-js";
import type { ProjectListResponse } from "./api";

type Ctx = {
  projects: Resource<ProjectListResponse>;
  refetch: () => Promise<ProjectListResponse | undefined> | void;
};

export const ProjectsContext = createContext<Ctx>();

export function useProjects(): Ctx {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("ProjectsContext missing");
  return ctx;
}
