import type { ProjectRow } from "../api";
import { lastActivity } from "./project-list";

export type ViewPreset = "compact" | "status" | "detail";

/** Density order, least to most. Drives the toolbar's segmented control. */
export const VIEW_PRESETS: ViewPreset[] = ["compact", "status", "detail"];

/** `bare` renders borderless and unlabelled — used only for the age chip. */
export type ChipTone =
  | "neutral" | "dirty" | "ahead" | "behind" | "running" | "agent" | "bare";

export type Chip = { key: string; label: string; tone: ChipTone; title?: string };
export type DetailRow = { label: string; value: string };

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/**
 * Compact relative age: `30s` `3m` `6h` `2d` `2w` `4mo` `2y`.
 * `m` is minutes and `mo` is months — deliberately distinct.
 * `now` is a parameter rather than `Date.now()` so this is testable.
 */
export function relativeAge(ms: number | null, now: number): string {
  if (ms === null || ms === 0) return "—";
  const d = Math.max(0, now - ms);
  if (d < MIN) return `${Math.floor(d / 1000)}s`;
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 30 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  if (d < 365 * DAY) return `${Math.floor(d / (30 * DAY))}mo`;
  return `${Math.floor(d / (365 * DAY))}y`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function distinctPorts(p: ProjectRow): number[] {
  const set = new Set<number>();
  for (const proc of p.snapshot?.services.processes ?? []) {
    for (const port of proc.ports) set.add(port);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The `status` preset's chip row, in a fixed order so the eye learns positions.
 * A chip is omitted entirely when its value is zero or absent — that omission
 * is the signal. There is deliberately no `clean` chip: the absence of `+N`
 * already carries it.
 */
export function statusChips(p: ProjectRow, now: number): Chip[] {
  const chips: Chip[] = [];
  const snap = p.snapshot;

  if (snap) {
    const g = snap.git;
    if (g.dirty) {
      chips.push({ key: "dirty", label: `+${g.changed}`, tone: "dirty",
                   title: `${g.changed} changed file(s)` });
    }
    if (g.ahead > 0) {
      chips.push({ key: "ahead", label: `↑${g.ahead}`, tone: "ahead",
                   title: "commits ahead of upstream" });
    }
    if (g.behind > 0) {
      chips.push({ key: "behind", label: `↓${g.behind}`, tone: "behind",
                   title: "commits behind upstream" });
    }

    const running = snap.services.docker.filter((d) => d.state === "running").length;
    const stopped = snap.services.docker.filter((d) => d.state === "stopped").length;
    if (running > 0) chips.push({ key: "running", label: `${running} running`, tone: "running" });
    if (stopped > 0) chips.push({ key: "stopped", label: `${stopped} stopped`, tone: "neutral" });

    const procs = snap.services.processes.length;
    if (procs > 0) {
      chips.push({ key: "procs", label: plural(procs, "process", "processes"), tone: "neutral" });
    }
  }

  if (p.liveSessions > 0) {
    chips.push({ key: "terms", label: plural(p.liveSessions, "terminal", "terminals"),
                 tone: "neutral", title: "open terminals in forest" });
  }

  for (const port of distinctPorts(p)) {
    chips.push({ key: `port-${port}`, label: `:${port}`, tone: "neutral" });
  }

  if (p.liveAgents.length > 0) {
    const total = p.liveAgents.reduce((n, a) => n + a.count, 0);
    chips.push({
      key: "agents", label: `🤖 ${total}`, tone: "agent",
      title: p.liveAgents.map((a) => `${a.count} ${a.agent}`).join(", "),
    });
  }

  // Always last, and always bare.
  chips.push({ key: "age", label: relativeAge(lastActivity(p) || null, now), tone: "bare" });
  return chips;
}

/** The `compact` preset's single dim line. */
export function compactLine(p: ProjectRow, now: number): string {
  const snap = p.snapshot;
  if (!snap) return "not scanned yet";
  const branch = snap.git.branch ?? "detached";
  const git = snap.git.dirty ? `+${snap.git.changed}` : "clean";
  return `${branch} · ${git} · ${relativeAge(lastActivity(p) || null, now)}`;
}

/** The `detail` preset's labelled rows. Rows with nothing to say are omitted. */
export function detailRows(p: ProjectRow, now: number): DetailRow[] {
  const snap = p.snapshot;
  if (!snap) return [];
  const rows: DetailRow[] = [];
  const g = snap.git;

  const bits = [g.branch ?? "detached"];
  if (g.dirty) bits.push(`+${g.changed}`);
  if (g.ahead > 0) bits.push(`↑${g.ahead}`);
  if (g.behind > 0) bits.push(`↓${g.behind}`);
  if (!g.dirty) bits.push("clean");
  rows.push({ label: "branch", value: bits.join(" ") });

  if (g.lastCommit) {
    rows.push({
      label: "commit",
      value: `${relativeAge(g.lastCommit.timestamp, now)} · ${g.lastCommit.message}`,
    });
  }
  if (snap.lastEdit) {
    rows.push({ label: "edited", value: relativeAge(snap.lastEdit, now) });
  }

  const named = [
    ...snap.services.processes.map((proc) =>
      proc.ports.length ? `${proc.command} ${proc.ports.map((n) => `:${n}`).join(" ")}` : proc.command),
    ...snap.services.docker.filter((d) => d.state === "running").map((d) => d.name),
    ...snap.services.docker.filter((d) => d.state === "stopped").map((d) => d.name),
  ];
  if (named.length > 0) rows.push({ label: "run", value: named.join(" · ") });

  if (snap.errors.length > 0) {
    rows.push({ label: "issues", value: snap.errors.join(" · ") });
  }
  return rows;
}
