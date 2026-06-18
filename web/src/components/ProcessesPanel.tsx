import { For, Show, createSignal } from "solid-js";
import { listProcessDetail, type ProcessDetail } from "../api";
import PanelShell from "./PanelShell";

function ProcessRow(props: { p: ProcessDetail }) {
  const [open, setOpen] = createSignal(false);
  const startedAgo = () => {
    const ms = Date.now() - props.p.startedAt;
    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    return `${Math.floor(ms / 3_600_000)}h ago`;
  };
  return (
    <div class={`proc-row ${open() ? "open" : ""}`}>
      <button class="proc-row-summary" onclick={() => setOpen(!open())}>
        <span class="proc-pid">{props.p.pid}</span>
        <span class="proc-cpu">{props.p.cpu.toFixed(1)}</span>
        <span class="proc-mem">{props.p.memMB}M</span>
        <span class="proc-cmd" title={props.p.command}>{props.p.command}</span>
        <span class="proc-ports">
          {props.p.ports.length > 0 ? props.p.ports.map((n) => `:${n}`).join(" ") : "—"}
        </span>
      </button>
      <Show when={open()}>
        <div class="proc-row-detail">
          <div><span class="muted">cwd</span> {props.p.cwd}</div>
          <div><span class="muted">ppid</span> {props.p.ppid}</div>
          <div><span class="muted">user</span> {props.p.user}</div>
          <div><span class="muted">started</span> {startedAgo()}</div>
        </div>
      </Show>
    </div>
  );
}

export default function ProcessesPanel(props: { projectId: string; enabled: () => boolean }) {
  return (
    <PanelShell
      title="Processes"
      fetcher={() => listProcessDetail(props.projectId)}
      pollMs={3000}
      enabled={props.enabled}
      keyField={"pid" as const}
      emptyMessage="no processes with cwd inside this project"
    >
      {(rows) => (
        <div class="proc-table">
          <div class="proc-row-head">
            <span class="proc-pid">PID</span>
            <span class="proc-cpu">%CPU</span>
            <span class="proc-mem">MEM</span>
            <span class="proc-cmd">COMMAND</span>
            <span class="proc-ports">PORTS</span>
          </div>
          <For each={rows}>{(p) => <ProcessRow p={p} />}</For>
        </div>
      )}
    </PanelShell>
  );
}
