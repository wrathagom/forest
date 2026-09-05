// server/src/lifecycle/registry.ts

export type LastRun = {
  kind: "start" | "stop";
  exitCode: number;
  output: string;
  at: number;
  failed: boolean;
};

type TransientStatus = "starting" | "stopping";

type Entry = { transient?: TransientStatus; lastRun?: LastRun };

/**
 * In-memory only: transient start/stop state and the last run's captured output,
 * keyed per *target*. A target is either the top-level lifecycle (no `section`)
 * or a named section. Section state is independent of the top level and of
 * other sections, so starting one section never blocks another.
 */
export class LifecycleRegistry {
  private map = new Map<string, Entry>();

  private key(id: string, section?: string): string {
    return section === undefined ? id : `${id} ${section}`;
  }

  private entry(id: string, section?: string): Entry {
    const k = this.key(id, section);
    let e = this.map.get(k);
    if (!e) { e = {}; this.map.set(k, e); }
    return e;
  }

  setTransient(id: string, status: TransientStatus, section?: string): void {
    this.entry(id, section).transient = status;
  }
  clearTransient(id: string, section?: string): void {
    const e = this.map.get(this.key(id, section));
    if (e) delete e.transient;
  }
  transient(id: string, section?: string): TransientStatus | null {
    return this.map.get(this.key(id, section))?.transient ?? null;
  }
  inFlight(id: string, section?: string): boolean {
    return this.transient(id, section) !== null;
  }

  setLastRun(id: string, run: LastRun, section?: string): void {
    this.entry(id, section).lastRun = run;
  }
  lastRun(id: string, section?: string): LastRun | null {
    return this.map.get(this.key(id, section))?.lastRun ?? null;
  }
}
