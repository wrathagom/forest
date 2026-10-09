import { For, Index, Show, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ProjectRow } from "../api";
import { refreshProject, patchProject, relocateProject } from "../api";
import CardMenu from "./CardMenu";
import { bandColor, type ColorByDimension } from "../lib/colorBy";
import {
  compactLine, detailRows, statusChips, type ViewPreset,
} from "../lib/dashboard-view";
import { currentTheme } from "../lib/themes/current";

export default function ProjectCard(props: {
  project: ProjectRow;
  preset: ViewPreset;
  colorBy: ColorByDimension;
  groups: string[];
  onChange: () => void;
}) {
  const nav = useNavigate();

  // currentTheme() reads themeId(), so the band recolors on a theme change.
  // Memoized so bg/fg/neutral come from one evaluation rather than three —
  // this is read once for the class and twice more inside the style object.
  const band = createMemo(() =>
    bandColor(props.project, props.colorBy, props.groups, currentTheme(), Date.now()));

  const open = () => nav(`/projects/${encodeURIComponent(props.project.id)}`);

  const onRefresh = async () => {
    await refreshProject(props.project.id);
    props.onChange();
  };
  const onTogglePin = async () => {
    await patchProject(props.project.id, { pinned: !props.project.pinned });
    props.onChange();
  };
  const onToggleArchive = async () => {
    await patchProject(props.project.id, { hidden: !props.project.hidden });
    props.onChange();
  };
  const onCopyPath = () => {
    void navigator.clipboard?.writeText(props.project.path);
  };
  const onRelocate = async () => {
    const next = window.prompt("New absolute path for this project:", props.project.path);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === props.project.path) return;
    try {
      await relocateProject(props.project.id, trimmed);
      props.onChange();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const onCardClick = (e: MouseEvent) => {
    // CardMenu stops its own clicks, so anything arriving here is the body.
    if ((e.target as HTMLElement).closest(".card-menu")) return;
    open();
  };

  return (
    <div class="card card-clickable" onclick={onCardClick}>
      <div
        class={`card-band${band().neutral ? " neutral" : ""}`}
        style={{ "--k": band().bg, "--kfg": band().fg }}
      >
        <span class="card-title" title={props.project.name}>{props.project.name}</span>
        <span class="card-band-right">
          <Show when={props.project.hidden}>
            <span class="card-band-tag archived" title="archived">archived</span>
          </Show>
          <Show when={props.project.group}>
            <span class="card-band-tag" title="inferred from sub-directory under scan root">
              {props.project.group}
            </span>
          </Show>
          <CardMenu
            pinned={props.project.pinned}
            hidden={props.project.hidden}
            onOpen={open}
            onRefresh={onRefresh}
            onCopyPath={onCopyPath}
            onRelocate={onRelocate}
            onTogglePin={onTogglePin}
            onToggleArchive={onToggleArchive}
          />
        </span>
      </div>

      <div class="card-body">
        <Show when={props.preset === "compact"}>
          <div class="card-line">{compactLine(props.project, Date.now())}</div>
        </Show>

        <Show when={props.preset === "status"}>
          <Show
            when={props.project.snapshot}
            fallback={<div class="card-line faint">not scanned yet</div>}
          >
            {(snap) => (
              <>
                <div class="card-branch">{snap().git.branch ?? "detached"}</div>
                <Show when={snap().errors.length > 0}>
                  <ul class="card-errors">
                    <For each={snap().errors}>{(e) => <li>{e}</li>}</For>
                  </ul>
                </Show>
                <div class="card-chips">
                  {/* <Index>, not <For>: statusChips() builds fresh objects on
                      every evaluation, and <For> would rebuild the link under
                      the cursor each time, swallowing the click. */}
                  <Index each={statusChips(props.project, Date.now())}>
                    {(c) => (
                      <Show
                        when={c().href}
                        fallback={<span class={`chip chip-${c().tone}`} title={c().title}>{c().label}</span>}
                      >
                        <a
                          class={`chip chip-${c().tone}`}
                          href={c().href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={c().title}
                          onclick={(e) => e.stopPropagation()}
                        >
                          {c().label}
                        </a>
                      </Show>
                    )}
                  </Index>
                </div>
              </>
            )}
          </Show>
        </Show>

        <Show when={props.preset === "detail"}>
          <Show
            when={props.project.snapshot}
            fallback={<div class="card-line faint">not scanned yet</div>}
          >
            <dl class="card-rows">
              <For each={detailRows(props.project, Date.now())}>
                {(row) => (
                  <>
                    <dt>{row.label}</dt>
                    <dd class={row.label === "commit" ? "clamp-2" : undefined}>{row.value}</dd>
                  </>
                )}
              </For>
            </dl>
          </Show>
        </Show>
      </div>
    </div>
  );
}
