import { For } from "solid-js";
import type { ProjectRow } from "../api";
import ProjectCard from "./ProjectCard";

export default function ProjectGrid(props: { projects: ProjectRow[]; onChange: () => void }) {
  return (
    <div class="grid">
      <For each={props.projects}>
        {(p) => <ProjectCard project={p} onChange={props.onChange} />}
      </For>
    </div>
  );
}
