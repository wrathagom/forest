import type { LiveEntry } from "../sessions/live";

export type ContentItem = {
  type: "text" | "markdown" | "widget";
  value?: string;
  widget_type?: string;
  widget_config?: Record<string, unknown>;
  panel_color?: string;
  font_color?: string;
  grid_column?: string;
  wrap?: boolean;
};

export type PageRender = { content: ContentItem[]; layout: string };
export type AlertKind = "waiting" | "stop";

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function rel(now: number, t: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function label(e: LiveEntry): string {
  return e.projectName ?? e.cwd.split("/").filter(Boolean).pop() ?? "session";
}

function sessionPanel(e: LiveEntry, now: number): ContentItem {
  const waiting = e.state === "waiting";
  const lines: string[] = [`**${waiting ? "🟡" : "🟢"} ${label(e)}**`];
  const branch = e.worktreeLabel ?? e.branch;
  if (branch) lines.push(`\`${branch}\``);
  if (e.profile) lines.push(`_${e.profile}_`);
  if (e.lastUserMsg) lines.push(truncate(e.lastUserMsg, 80));
  lines.push(`_${rel(now, e.lastEventAt)}_`);
  return { type: "markdown", value: lines.join("\n\n"), panel_color: waiting ? "#7a5b16" : "#1f3d2a" };
}

export function renderHud(entries: LiveEntry[], now: number, opts: { panelCap: number }): PageRender {
  const active = entries.filter((e) => e.state === "working" || e.state === "waiting");
  const working = active.filter((e) => e.state === "working").length;
  const waiting = active.filter((e) => e.state === "waiting").length;
  const header: ContentItem = {
    type: "markdown",
    value: `### Forest\n\n🟢 ${working} working · 🟡 ${waiting} waiting`,
    grid_column: "1 / -1",
  };
  const clock: ContentItem = {
    type: "widget",
    widget_type: "clock",
    widget_config: { style: "digital", format: "12h", timezone: "local" },
  };
  if (active.length === 0) {
    return { layout: "dashboard-header", content: [header, clock, { type: "markdown", value: "_No active sessions_" }] };
  }
  const shown = active.slice(0, opts.panelCap);
  const panels = shown.map((e) => sessionPanel(e, now));
  if (active.length > opts.panelCap) {
    panels.push({ type: "markdown", value: `**+${active.length - opts.panelCap} more**` });
  }
  return { layout: "dashboard-header", content: [header, clock, ...panels] };
}

export function renderAlert(e: LiveEntry, kind: AlertKind): { content: ContentItem[] } {
  const head = kind === "waiting" ? `🔔 ${label(e)} needs you` : `✅ ${label(e)} finished`;
  const body = e.lastUserMsg ? truncate(e.lastUserMsg, 140) : "";
  const value = body ? `# ${head}\n\n${body}` : `# ${head}`;
  return {
    content: [
      {
        type: "markdown",
        value,
        panel_color: kind === "waiting" ? "#a01b1b" : "#16407a",
        font_color: "#ffffff",
        wrap: false,
      },
    ],
  };
}
