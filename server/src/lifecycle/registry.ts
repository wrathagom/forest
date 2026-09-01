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

/** In-memory only: transient start/stop state and the last run's captured output. */
export class LifecycleRegistry {
  private map = new Map<string, Entry>();

  private entry(id: string): Entry {
    let e = this.map.get(id);
    if (!e) { e = {}; this.map.set(id, e); }
    return e;
  }

  setTransient(id: string, status: TransientStatus): void {
    this.entry(id).transient = status;
  }
  clearTransient(id: string): void {
    const e = this.map.get(id);
    if (e) delete e.transient;
  }
  transient(id: string): TransientStatus | null {
    return this.map.get(id)?.transient ?? null;
  }
  inFlight(id: string): boolean {
    return this.transient(id) !== null;
  }

  setLastRun(id: string, run: LastRun): void {
    this.entry(id).lastRun = run;
  }
  lastRun(id: string): LastRun | null {
    return this.map.get(id)?.lastRun ?? null;
  }
}
