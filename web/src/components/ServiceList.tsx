import { For, Show } from "solid-js";
import type { Snapshot } from "../api";

export default function ServiceList(props: { services: Snapshot["services"]; liveSessions?: number }) {
  const counts = () => {
    const running = props.services.docker.filter((d) => d.state === "running").length;
    const stopped = props.services.docker.filter((d) => d.state === "stopped").length;
    const procs = props.services.processes.length;
    const sessions = props.liveSessions ?? 0;
    return { running, stopped, procs, sessions, total: running + stopped + procs + sessions };
  };

  const ports = () => {
    const set = new Set<number>();
    for (const p of props.services.processes) for (const port of p.ports) set.add(port);
    return [...set].sort((a, b) => a - b);
  };

  return (
    <div class="services">
      <Show when={counts().total > 0} fallback={<span class="muted">no services</span>}>
        <Show when={counts().running > 0}>
          <span class="svc-count svc-running">{counts().running} running</span>
        </Show>
        <Show when={counts().stopped > 0}>
          <span class="svc-count svc-stopped">{counts().stopped} stopped</span>
        </Show>
        <Show when={counts().procs > 0}>
          <span class="svc-count svc-procs">
            {counts().procs} {counts().procs === 1 ? "process" : "processes"}
          </span>
        </Show>
        <Show when={counts().sessions > 0}>
          <span class="svc-count svc-terminals" title="open terminals in forest">
            {counts().sessions} {counts().sessions === 1 ? "terminal" : "terminals"}
          </span>
        </Show>
      </Show>
      <Show when={ports().length > 0}>
        <div class="ports">
          <For each={ports()}>{(p) => <span class="port-chip">:{p}</span>}</For>
        </div>
      </Show>
    </div>
  );
}
