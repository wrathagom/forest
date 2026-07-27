import { For } from "solid-js";
import type { ProjectRow } from "../api";
import ProjectCard from "./ProjectCard";
import type { ColorByDimension } from "../lib/colorBy";
import type { ViewPreset } from "../lib/dashboard-view";

export default function ProjectGrid(props: {
  projects: ProjectRow[];
  preset: ViewPreset;
  colorBy: ColorByDimension;
  groups: string[];
  onChange: () => void;
}) {
  return (
    <div class="grid">
      <For each={props.projects}>
        {(p) => (
          <ProjectCard
            project={p}
            preset={props.preset}
            colorBy={props.colorBy}
            groups={props.groups}
            onChange={props.onChange}
          />
        )}
      </For>
    </div>
  );
}
