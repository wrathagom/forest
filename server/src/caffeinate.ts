import type { Database } from "bun:sqlite";
import {
  getCaffeinateState,
  setCaffeinateState,
  clearCaffeinateState,
} from "./store/config";

export type Status = {
  supported: boolean;
  active: boolean;
  endsAt: number | null;
  indefinite: boolean;
};

export type SpawnedChild = {
  kill: () => void;
  onExit: (cb: () => void) => void;
};

export type SpawnFn = () => SpawnedChild;

export type Deps = {
  db: Database;
  spawn?: SpawnFn;
  now?: () => number;
  platform?: NodeJS.Platform | string;
};

function defaultSpawn(): SpawnedChild {
  // `caffeinate -i` prevents idle sleep but allows display sleep.
  // stdio is ignored; the child dies with the parent (detached: false default).
  const proc = Bun.spawn(["caffeinate", "-i"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  let exitCb: (() => void) | null = null;
  void proc.exited.then(() => exitCb?.());
  return {
    kill: () => { try { proc.kill(); } catch { /* already dead */ } },
    onExit: (cb) => { exitCb = cb; },
  };
}

export type Controller = {
  init: () => void;
  start: (durationSec: number | null) => Status;
  stop: () => Status;
  status: () => Status;
};

export function createCaffeinate(deps: Deps): Controller {
  const { db } = deps;
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;
  const supported = platform === "darwin";

  let child: SpawnedChild | null = null;
  let endsAt: number | null = null;
  let durationSec: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function clearInMemory(): void {
    child = null;
    endsAt = null;
    durationSec = null;
    clearTimer();
  }

  function status(): Status {
    return {
      supported,
      active: child !== null,
      endsAt,
      indefinite: child !== null && durationSec === null,
    };
  }

  function stop(): Status {
    if (child) {
      const c = child;
      // Clear state first so the exit handler sees no child to clean up twice.
      clearInMemory();
      c.kill();
      clearCaffeinateState(db);
    }
    return status();
  }

  function start(d: number | null): Status {
    if (!supported) throw new Error("caffeinate not supported on this platform");
    if (child) {
      // Replace: kill existing, then start fresh.
      const old = child;
      clearInMemory();
      old.kill();
    }
    const c = spawn();
    child = c;
    durationSec = d;
    const startedAt = now();
    endsAt = d === null ? null : startedAt + d * 1000;
    setCaffeinateState(db, { startedAt, durationSec: d });

    c.onExit(() => {
      // Only clean up if this is still the active child (start() may have
      // replaced it, in which case `child` already points elsewhere).
      if (child === c) {
        clearInMemory();
        clearCaffeinateState(db);
      }
    });

    if (d !== null) {
      const ms = Math.max(0, d * 1000);
      timer = setTimeout(() => { stop(); }, ms);
    }
    return status();
  }

  function init(): void {
    if (!supported) return;
    const persisted = getCaffeinateState(db);
    if (!persisted) return;
    if (persisted.durationSec === null) {
      // Indefinite — resume.
      // start() rewrites startedAt to now(); for indefinite that's fine since
      // there's no expiry to recompute.
      start(null);
      return;
    }
    const endsAtPersisted = persisted.startedAt + persisted.durationSec * 1000;
    const remainingMs = endsAtPersisted - now();
    if (remainingMs <= 0) {
      clearCaffeinateState(db);
      return;
    }
    // Resume with the remaining time (rounded up to a whole second).
    start(Math.ceil(remainingMs / 1000));
  }

  return { init, start, stop, status };
}
