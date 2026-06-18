import type { BbsClient } from "./client";
import type { BbsConfig } from "../store/config";
import type { LiveEntry } from "../sessions/live";
import { renderHud, renderAlert, type AlertKind } from "./render";

export type BbsPublisherDeps = {
  client: Pick<BbsClient, "putPage" | "deletePage">;
  getConfig: () => BbsConfig;
  list: () => LiveEntry[];
  now: () => number;
  log?: (level: "info" | "warn", msg: string, meta?: Record<string, unknown>) => void;
};

const RESUME_EVENTS = new Set(["userpromptsubmit", "pretooluse", "posttooluse", "sessionend", "dismiss"]);
const DEBOUNCE_MS = 1_000;

export class BbsPublisher {
  private readonly pendingAlerts = new Map<string, AlertKind>();
  private readonly pendingClears = new Set<string>();
  private readonly alertExpiries = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastOk: number | null = null;
  private lastError: string | null = null;
  private publishing = false;

  constructor(private readonly deps: BbsPublisherDeps) {}

  notifyChange(ctx: { event?: string; agentSessionId?: string }): void {
    const cfg = this.deps.getConfig();
    if (!cfg.enabled) return;
    const sid = ctx.agentSessionId;
    const ev = ctx.event;
    if (sid && ev) {
      if (ev === "notification" && cfg.alertEvents.includes("waiting")) {
        this.pendingClears.delete(sid);
        this.pendingAlerts.set(sid, "waiting");
      } else if (ev === "stop" && cfg.alertEvents.includes("stop")) {
        this.pendingClears.delete(sid);
        this.pendingAlerts.set(sid, "stop");
      } else if (RESUME_EVENTS.has(ev)) {
        this.pendingAlerts.delete(sid);
        this.pendingClears.add(sid);
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.publishNow();
    }, DEBOUNCE_MS);
  }

  async publishNow(): Promise<void> {
    if (this.publishing) {
      // A publish is already in flight; re-arm the debounce so pending work runs right after it finishes.
      this.schedule();
      return;
    }
    const cfg = this.deps.getConfig();
    if (!cfg.enabled || !cfg.screenId || !cfg.screenKey) return;
    this.publishing = true;
    try {
      const entries = this.deps.list();
      const now = this.deps.now();
      const alerts = [...this.pendingAlerts];
      this.pendingAlerts.clear();
      const clears = [...this.pendingClears];
      this.pendingClears.clear();
      try {
        const hud = renderHud(entries, now, { panelCap: cfg.hudPanelCap });
        await this.deps.client.putPage(cfg.screenKey, cfg.screenId, "default", { content: hud.content, layout: hud.layout });
        for (const [sid, kind] of alerts) {
          const e = entries.find((x) => x.agentSessionId === sid);
          // No live entry (e.g. a stop that already aged out of the list) → nothing to render; drop it.
          if (!e) continue;
          // Flash guard: a `waiting` alert that already resolved before this publish (instantly-answered
          // AskUserQuestion) should not flash. `stop` alerts are not flash-guarded.
          if (kind === "waiting" && e.state !== "waiting") continue;
          const a = renderAlert(e, kind);
          await this.deps.client.putPage(cfg.screenKey, cfg.screenId, `alert-${sid}`, { content: a.content });
          this.alertExpiries.set(sid, now + cfg.alertLingerSec * 1000);
          this.armExpirySweep(cfg.alertLingerSec * 1000);
        }
        for (const sid of clears) {
          await this.deps.client.deletePage(cfg.screenKey, cfg.screenId, `alert-${sid}`);
          this.alertExpiries.delete(sid);
        }
        for (const [sid, exp] of [...this.alertExpiries]) {
          if (exp <= now) {
            await this.deps.client.deletePage(cfg.screenKey, cfg.screenId, `alert-${sid}`);
            this.alertExpiries.delete(sid);
          }
        }
        this.lastOk = now;
        this.lastError = null;
      } catch (err) {
        this.lastError = (err as Error).message;
        this.deps.log?.("warn", "bbs: publish failed", { error: this.lastError });
      }
    } finally {
      this.publishing = false;
    }
  }

  /** Push a one-off sample alert so the user can confirm the screen works. */
  async sendTest(): Promise<void> {
    const cfg = this.deps.getConfig();
    if (!cfg.screenId || !cfg.screenKey) throw new Error("BBS screen is not provisioned");
    await this.deps.client.putPage(cfg.screenKey!, cfg.screenId!, "alert-test", {
      content: [{ type: "markdown", value: "# 🔔 Forest test alert", panel_color: "#a01b1b", font_color: "#ffffff", wrap: false }],
    });
    setTimeout(() => void this.deps.client.deletePage(cfg.screenKey!, cfg.screenId!, "alert-test").catch(() => {}), cfg.alertLingerSec * 1000).unref?.();
  }

  private armExpirySweep(ms: number): void {
    setTimeout(() => void this.publishNow(), ms).unref?.();
  }

  startHeartbeat(): void {
    if (this.heartbeat) return;
    const cfg = this.deps.getConfig();
    this.heartbeat = setInterval(() => {
      if (this.deps.getConfig().enabled) void this.publishNow();
    }, cfg.hudIntervalMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = null;
    this.heartbeat = null;
  }

  status(): { lastOk: number | null; lastError: string | null } {
    return { lastOk: this.lastOk, lastError: this.lastError };
  }
}
