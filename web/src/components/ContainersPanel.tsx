import { For, Show, createSignal } from "solid-js";
import { listContainerDetail, type ContainerDetail } from "../api";
import PanelShell from "./PanelShell";

function ContainerRow(props: { c: ContainerDetail }) {
  const [open, setOpen] = createSignal(false);
  const portSummary = () => {
    if (props.c.ports.length === 0) return "—";
    return props.c.ports.map((p) => `:${p.container}`).join(" ");
  };
  const uptime = () => {
    if (props.c.state !== "running" || props.c.startedAt === null) {
      if (props.c.state === "exited" && props.c.exitCode !== null) return `exited (${props.c.exitCode})`;
      return props.c.state;
    }
    const ms = Date.now() - props.c.startedAt;
    if (!Number.isFinite(ms) || ms < 0) return "up";
    if (ms < 60_000) return `up ${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `up ${Math.floor(ms / 60_000)}m`;
    return `up ${Math.floor(ms / 3_600_000)}h`;
  };
  return (
    <div class={`cont-row state-${props.c.state} ${open() ? "open" : ""}`}>
      <button class="cont-row-summary" onclick={() => setOpen(!open())}>
        <span class={`dot dot-${props.c.state === "running" ? "ok" : "warn"}`} />
        <span class="cont-service">{props.c.service}</span>
        <span class="cont-image" title={props.c.image}>{props.c.image}</span>
        <span class="cont-ports">{portSummary()}</span>
        <span class="cont-uptime">{uptime()}</span>
      </button>
      <Show when={open()}>
        <div class="cont-row-detail">
          <div><span class="muted">name</span> {props.c.containerName}</div>
          <Show when={props.c.ports.length > 0}>
            <div>
              <span class="muted">ports</span>{" "}
              {props.c.ports.map((p) => `${p.host}:${p.container}/${p.protocol}`).join(", ")}
            </div>
          </Show>
          <Show when={props.c.health}>
            <div><span class="muted">health</span> {props.c.health}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default function ContainersPanel(props: { projectId: string; enabled: () => boolean }) {
  return (
    <PanelShell
      title="Containers"
      fetcher={() => listContainerDetail(props.projectId)}
      pollMs={8000}
      enabled={props.enabled}
      keyField={"service" as const}
      emptyMessage="no docker-compose.yml in this project"
    >
      {(rows) => (
        <div class="cont-table">
          <For each={rows}>{(c) => <ContainerRow c={c} />}</For>
        </div>
      )}
    </PanelShell>
  );
}
