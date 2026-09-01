# forest.yaml Project Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project `forest.yaml` (`start` / `stop` / `health`) that Forest can act on — Start/Stop buttons, a health probe on the scan tick, and a new `lifecycle` status dimension for dashboard cards.

**Architecture:** A self-contained `server/src/lifecycle/` module (config reader, one-shot command runner, pure status calculator, in-memory transient registry) keeps the pure scanner untouched. The loop's `scanProject` dependency is wrapped so that, only for lifecycle-enabled projects whose services are already up, it runs the health command and folds a `lifecycle` field into the `Snapshot`. Opt-in per project (a `lifecycle_enabled` column) is the security boundary. The web UI adds a lifecycle panel to the project header and a `lifecycle` color-by dimension + card chip.

**Tech Stack:** Bun + TypeScript (server, `bun test`), SolidJS + Vite (web, `vitest`). Bun's built-in `YAML` parses the file; `Bun.spawn` runs commands.

**Status notes (deviations from spec, as built):**
1. The spec listed `start-failed` / `stop-failed` as distinct card statuses. To avoid sticky error colors (after a failed start nothing is up, so the true steady state is `stopped`), the card `LifecycleStatus` is `none | stopped | running | healthy | errors | starting | stopping`. A failed run is surfaced in the **panel** via `lastRun.failed` + its output, not as a persistent card color.
2. The transient `starting` / `stopping` states are applied **panel-only** (in the route's `view()`, which consults the registry), not by the scan wrapper — so during an in-flight start/stop the dashboard card keeps showing the last stored status until `loop.refresh` reconciles it after the command returns. This is a deliberate simplification: under the one-shot, returns-promptly execution model the transient window is brief, the panel the user clicked in is always correct, and it avoids coupling the ephemeral registry into the scan path.

---

## File Structure

**Server — new:**
- `server/src/lifecycle/config.ts` — `readConfig(path)`: parse `<path>/forest.yaml` → `ForestConfig | null`.
- `server/src/lifecycle/status.ts` — `LifecycleStatus` type + `computeLifecycle(input)`: pure calculator.
- `server/src/lifecycle/run.ts` — `runCommand(cmd, cwd, opts)`: one-shot `sh -c` spawn.
- `server/src/lifecycle/registry.ts` — `LifecycleRegistry`: in-memory transient + last-run store.
- `server/src/lifecycle/augment.ts` — `augmentWithLifecycle(...)`: folds lifecycle into a `Snapshot`.
- `server/src/routes/lifecycle.ts` — `lifecycleRoutes(deps)`: GET view + enable/start/stop.

**Server — modified:**
- `server/src/scanner/types.ts` — add `lifecycle` to `Snapshot`; seed in `emptySnapshot()`.
- `server/src/store/db.ts` — add `lifecycle_enabled` column.
- `server/src/store/projects.ts` — `lifecycleEnabled` on `Project` + `ProjectPatch` + `updateProject`.
- `server/src/index.ts` — construct registry, wrap `scanProject`, register `lifecycleRoutes`.

**Web — new:**
- `web/src/components/LifecyclePanel.tsx` — status chip, Start/Stop, output, enable gate.

**Web — modified:**
- `web/src/api.ts` — `LifecycleStatus`, `LifecycleView` types + `lifecycle` field on `Snapshot`; `fetchLifecycle` / `setLifecycleEnabled` / `startLifecycle` / `stopLifecycle`.
- `web/src/lib/colorBy.ts` — add `"lifecycle"` to the union, `COLOR_BY_DIMENSIONS`, `hueFor`, `legend`.
- `web/src/lib/dashboard-view.ts` — add `"error"` `ChipTone` + a lifecycle chip in `statusChips`.
- `web/src/pages/ProjectDetail.tsx` — render `<LifecyclePanel>` under `<ProjectHeader>`.
- `web/src/styles.css` — `.chip-error` rule.

**Docs — modified:**
- `README.md` — a "Project lifecycle (`forest.yaml`)" section.

---

## Task 1: forest.yaml config reader

**Files:**
- Create: `server/src/lifecycle/config.ts`
- Test: `server/tests/lifecycle-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-config.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/lifecycle/config";

function tmpProject(yaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forest-cfg-"));
  if (yaml !== undefined) writeFileSync(join(dir, "forest.yaml"), yaml);
  return dir;
}

describe("readConfig", () => {
  test("parses start/stop/health", () => {
    const dir = tmpProject("start: docker compose up -d\nstop: docker compose down\nhealth: curl -fsS localhost:3000/up\n");
    expect(readConfig(dir)).toEqual({
      start: "docker compose up -d",
      stop: "docker compose down",
      health: "curl -fsS localhost:3000/up",
    });
  });

  test("returns null when the file is absent", () => {
    expect(readConfig(tmpProject())).toBeNull();
  });

  test("returns null on malformed YAML", () => {
    expect(readConfig(tmpProject("start: [unterminated\n"))).toBeNull();
  });

  test("keeps only string command keys, ignores extras", () => {
    const dir = tmpProject("start: make up\nname: ignored\nport: 3000\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("returns null when no command keys are present", () => {
    expect(readConfig(tmpProject("name: just-a-name\n"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-config.test.ts`
Expected: FAIL — cannot find module `../src/lifecycle/config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/lifecycle/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ForestConfig = {
  start?: string;
  stop?: string;
  health?: string;
};

/**
 * Read and parse `<projectPath>/forest.yaml`. Tolerant: a missing or malformed
 * file, or one with no string command keys, returns null. Only `start`, `stop`,
 * and `health` (each a string) are read; everything else is ignored.
 */
export function readConfig(projectPath: string): ForestConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(projectPath, "forest.yaml"), "utf8");
  } catch {
    return null; // no file
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch {
    return null; // malformed
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const cfg: ForestConfig = {};
  for (const key of ["start", "stop", "health"] as const) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") cfg[key] = v.trim();
  }
  if (cfg.start === undefined && cfg.stop === undefined && cfg.health === undefined) {
    return null;
  }
  return cfg;
}
```

Note: `Bun.YAML.parse` is built in (Bun ≥ 1.2). If unavailable in the pinned Bun, replace the `Bun.YAML.parse(raw)` line with a minimal top-level `key: value` line parser — but verify `Bun.YAML` first with `bun -e "console.log(typeof Bun.YAML)"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/config.ts server/tests/lifecycle-config.test.ts
git commit -m "feat(lifecycle): forest.yaml config reader"
```

---

## Task 2: Lifecycle status calculator

**Files:**
- Create: `server/src/lifecycle/status.ts`
- Test: `server/tests/lifecycle-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-status.test.ts
import { describe, expect, test } from "bun:test";
import { computeLifecycle } from "../src/lifecycle/status";

describe("computeLifecycle", () => {
  test("not enabled -> none (even with a config and services up)", () => {
    expect(computeLifecycle({ enabled: false, hasConfig: true, servicesUp: true, health: { exitCode: 0 } })).toBe("none");
  });

  test("enabled but no config -> none", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: false, servicesUp: false, health: null })).toBe("none");
  });

  test("enabled, nothing up -> stopped", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: false, health: null })).toBe("stopped");
  });

  test("enabled, up, no health run -> running", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: null })).toBe("running");
  });

  test("enabled, up, health exit 0 -> healthy", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: { exitCode: 0 } })).toBe("healthy");
  });

  test("enabled, up, health nonzero -> errors", () => {
    expect(computeLifecycle({ enabled: true, hasConfig: true, servicesUp: true, health: { exitCode: 1 } })).toBe("errors");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-status.test.ts`
Expected: FAIL — cannot find module `../src/lifecycle/status`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/lifecycle/status.ts

/** Steady-state statuses (transient starting/stopping come from the registry). */
export type LifecycleStatus =
  | "none"      // not enabled, or no forest.yaml
  | "stopped"   // enabled, nothing up
  | "running"   // enabled, up, no health command / health not run
  | "healthy"   // enabled, up, health exit 0
  | "errors"    // enabled, up, health exit nonzero
  | "starting"  // registry-owned
  | "stopping"; // registry-owned

export type LifecycleInput = {
  enabled: boolean;
  hasConfig: boolean;
  servicesUp: boolean;
  health: { exitCode: number } | null;
};

/** Pure: maps enabled/hasConfig/servicesUp/health to a steady-state status. */
export function computeLifecycle(input: LifecycleInput): LifecycleStatus {
  if (!input.enabled || !input.hasConfig) return "none";
  if (!input.servicesUp) return "stopped";
  if (input.health === null) return "running";
  return input.health.exitCode === 0 ? "healthy" : "errors";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-status.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/status.ts server/tests/lifecycle-status.test.ts
git commit -m "feat(lifecycle): pure status calculator"
```

---

## Task 3: One-shot command runner

**Files:**
- Create: `server/src/lifecycle/run.ts`
- Test: `server/tests/lifecycle-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-run.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/lifecycle/run";

describe("runCommand", () => {
  test("captures stdout and a zero exit code", async () => {
    const r = await runCommand("echo hello", process.cwd(), { timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("hello");
  });

  test("captures a nonzero exit code and stderr", async () => {
    const r = await runCommand("echo oops 1>&2; exit 3", process.cwd(), { timeoutMs: 5000 });
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("oops");
  });

  test("runs in the given cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forest-run-"));
    const r = await runCommand("pwd", dir, { timeoutMs: 5000 });
    // macOS symlinks /tmp -> /private/tmp; compare on the basename to stay portable.
    expect(r.output).toContain(dir.split("/").pop()!);
  });

  test("times out a hanging command", async () => {
    const r = await runCommand("sleep 5", process.cwd(), { timeoutMs: 150 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-run.test.ts`
Expected: FAIL — cannot find module `../src/lifecycle/run`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/lifecycle/run.ts

export type RunResult = {
  exitCode: number;
  output: string; // merged stdout + stderr
  timedOut: boolean;
};

export type RunOptions = { timeoutMs: number };

/**
 * Run `cmd` once through `sh -c` in `cwd`, capturing merged stdout+stderr and
 * the exit code. Aborts after `timeoutMs`, killing the process group. Intended
 * for commands that return promptly and background their real work.
 */
export async function runCommand(cmd: string, cwd: string, opts: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(); // SIGTERM
  }, opts.timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = (stdout + stderr).trim();
    return { exitCode: timedOut ? (exitCode || 124) : exitCode, output, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-run.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/run.ts server/tests/lifecycle-run.test.ts
git commit -m "feat(lifecycle): one-shot command runner"
```

---

## Task 4: Transient / last-run registry

**Files:**
- Create: `server/src/lifecycle/registry.ts`
- Test: `server/tests/lifecycle-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-registry.test.ts
import { describe, expect, test } from "bun:test";
import { LifecycleRegistry } from "../src/lifecycle/registry";

describe("LifecycleRegistry", () => {
  test("tracks a transient status and clears it", () => {
    const reg = new LifecycleRegistry();
    expect(reg.transient("p1")).toBeNull();
    reg.setTransient("p1", "starting");
    expect(reg.transient("p1")).toBe("starting");
    reg.clearTransient("p1");
    expect(reg.transient("p1")).toBeNull();
  });

  test("records and returns the last run", () => {
    const reg = new LifecycleRegistry();
    reg.setLastRun("p1", { kind: "start", exitCode: 0, output: "up", at: 123, failed: false });
    expect(reg.lastRun("p1")).toEqual({ kind: "start", exitCode: 0, output: "up", at: 123, failed: false });
    expect(reg.lastRun("p2")).toBeNull();
  });

  test("reports whether a project has a command in flight", () => {
    const reg = new LifecycleRegistry();
    expect(reg.inFlight("p1")).toBe(false);
    reg.setTransient("p1", "stopping");
    expect(reg.inFlight("p1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-registry.test.ts`
Expected: FAIL — cannot find module `../src/lifecycle/registry`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/registry.ts server/tests/lifecycle-registry.test.ts
git commit -m "feat(lifecycle): transient/last-run registry"
```

---

## Task 5: Snapshot type extension

**Files:**
- Modify: `server/src/scanner/types.ts`

- [ ] **Step 1: Update the `Snapshot` type and `emptySnapshot()`**

In `server/src/scanner/types.ts`, add an import at the top:

```ts
import type { LifecycleStatus } from "../lifecycle/status";
```

Add a `lifecycle` field to the `Snapshot` type (after `errors: string[];`):

```ts
  lifecycle: {
    status: LifecycleStatus;
    hasConfig: boolean;
    enabled: boolean;
    health: { exitCode: number } | null;
  };
```

Seed it in `emptySnapshot()` (inside the returned object, after `errors: []`):

```ts
    lifecycle: { status: "none", hasConfig: false, enabled: false, health: null },
```

- [ ] **Step 2: Verify the server still type-checks and tests pass**

Run: `cd server && bun test tests/store.test.ts`
Expected: PASS (existing snapshot-related tests still green; `emptySnapshot` now carries `lifecycle`).

- [ ] **Step 3: Commit**

```bash
git add server/src/scanner/types.ts
git commit -m "feat(lifecycle): add lifecycle field to Snapshot"
```

---

## Task 6: DB column + projects store

**Files:**
- Modify: `server/src/store/db.ts:openDb` (add column), `server/src/store/projects.ts`
- Test: `server/tests/lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-store.test.ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject, getProjectById, updateProject } from "../src/store/projects";

describe("lifecycleEnabled", () => {
  test("defaults to false and toggles via updateProject", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/proj", name: "proj" });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(false);

    updateProject(db, id, { lifecycleEnabled: true });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(true);

    updateProject(db, id, { lifecycleEnabled: false });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-store.test.ts`
Expected: FAIL — `lifecycleEnabled` is undefined / not a property.

- [ ] **Step 3: Add the column in `openDb`**

In `server/src/store/db.ts`, inside `openDb`, after the existing `addColumnIfMissing(db, "agent_sessions", "title", "TEXT");` line, add:

```ts
  addColumnIfMissing(db, "projects", "lifecycle_enabled", "INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 4: Thread the field through `projects.ts`**

In `server/src/store/projects.ts`:

Add to the `Project` type (after `group: string | null;`):
```ts
  lifecycleEnabled: boolean;
```

Add to the `Row` type (after `group_name: string | null;`):
```ts
  lifecycle_enabled: number;
```

In `fromRow`, add (after `group: r.group_name,`):
```ts
  lifecycleEnabled: r.lifecycle_enabled === 1,
```

Add to `ProjectPatch` (after `group?: string | null;`):
```ts
  lifecycleEnabled?: boolean;
```

In `updateProject`, add this block before the `if (sets.length === 0) return;` line:
```ts
  if (patch.lifecycleEnabled !== undefined) {
    sets.push("lifecycle_enabled = ?");
    args.push(patch.lifecycleEnabled ? 1 : 0);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-store.test.ts tests/store.test.ts`
Expected: PASS (new test + existing store tests still green).

- [ ] **Step 6: Commit**

```bash
git add server/src/store/db.ts server/src/store/projects.ts server/tests/lifecycle-store.test.ts
git commit -m "feat(lifecycle): persist per-project lifecycle_enabled flag"
```

---

## Task 7: Snapshot augmentation

**Files:**
- Create: `server/src/lifecycle/augment.ts`
- Test: `server/tests/lifecycle-augment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/lifecycle-augment.test.ts
import { describe, expect, test } from "bun:test";
import { emptySnapshot } from "../src/scanner/types";
import { augmentWithLifecycle } from "../src/lifecycle/augment";

function upSnap() {
  const s = emptySnapshot();
  s.services.processes = [{ pid: 1, command: "node", cwd: "/x", ports: [3000] }];
  return s;
}

describe("augmentWithLifecycle", () => {
  test("not enabled -> none, health never runs", async () => {
    let ran = false;
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: false,
      config: { health: "true" },
      runHealth: async () => { ran = true; return { exitCode: 0 }; },
    });
    expect(s.lifecycle.status).toBe("none");
    expect(ran).toBe(false);
  });

  test("enabled + up + passing health -> healthy", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { health: "true" },
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle).toEqual({ status: "healthy", hasConfig: true, enabled: true, health: { exitCode: 0 } });
  });

  test("enabled + up + failing health -> errors", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { health: "false" },
      runHealth: async () => ({ exitCode: 1 }),
    });
    expect(s.lifecycle.status).toBe("errors");
  });

  test("enabled + nothing up -> stopped, health not run", async () => {
    let ran = false;
    const s = await augmentWithLifecycle(emptySnapshot(), {
      enabled: true,
      config: { health: "true" },
      runHealth: async () => { ran = true; return { exitCode: 0 }; },
    });
    expect(s.lifecycle.status).toBe("stopped");
    expect(ran).toBe(false);
  });

  test("enabled + up + no health command -> running", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: { start: "make up" },
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle.status).toBe("running");
  });

  test("no config -> none", async () => {
    const s = await augmentWithLifecycle(upSnap(), {
      enabled: true,
      config: null,
      runHealth: async () => ({ exitCode: 0 }),
    });
    expect(s.lifecycle.status).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/lifecycle-augment.test.ts`
Expected: FAIL — cannot find module `../src/lifecycle/augment`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/lifecycle/augment.ts
import type { Snapshot } from "../scanner/types";
import type { ForestConfig } from "./config";
import { computeLifecycle } from "./status";

export type AugmentInput = {
  enabled: boolean;
  config: ForestConfig | null;
  /** Runs the health command; only called when enabled + config.health + servicesUp. */
  runHealth: () => Promise<{ exitCode: number }>;
};

function servicesUp(snap: Snapshot): boolean {
  return snap.services.docker.some((d) => d.state === "running") || snap.services.processes.length > 0;
}

/**
 * Fold a lifecycle status into `snap`. Health runs only when the project is
 * enabled, its config declares a `health` command, and services are already up —
 * so a discovered-but-not-enabled repo never executes anything.
 */
export async function augmentWithLifecycle(snap: Snapshot, input: AugmentInput): Promise<Snapshot> {
  const hasConfig = input.config !== null;
  const up = servicesUp(snap);
  let health: { exitCode: number } | null = null;

  if (input.enabled && hasConfig && input.config!.health && up) {
    health = await input.runHealth();
  }

  snap.lifecycle = {
    status: computeLifecycle({ enabled: input.enabled, hasConfig, servicesUp: up, health }),
    hasConfig,
    enabled: input.enabled,
    health,
  };
  return snap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/lifecycle-augment.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/augment.ts server/tests/lifecycle-augment.test.ts
git commit -m "feat(lifecycle): fold lifecycle status into snapshots"
```

---

## Task 8: HTTP routes

**Files:**
- Create: `server/src/routes/lifecycle.ts`
- Test: `server/tests/routes-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/routes-lifecycle.test.ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject } from "../src/store/projects";
import { LifecycleRegistry } from "../src/lifecycle/registry";
import { lifecycleRoutes } from "../src/routes/lifecycle";

function ctx(db: ReturnType<typeof openDb>, request: Request, params: Record<string, string>) {
  return { db, log: () => {}, loop: { refresh: async () => null } as never, url: new URL(request.url), params, request };
}

function deps(overrides: Partial<Parameters<typeof lifecycleRoutes>[0]> = {}) {
  return {
    registry: new LifecycleRegistry(),
    readConfig: () => ({ start: "make up", stop: "make down", health: "true" }),
    runCommand: async () => ({ exitCode: 0, output: "ok", timedOut: false }),
    ...overrides,
  };
}

function route(routes: ReturnType<typeof lifecycleRoutes>, method: string, suffix: RegExp) {
  return routes.find((r) => r.method === method && r.pattern.source.includes(suffix.source))!;
}

describe("lifecycle routes", () => {
  test("GET returns config, enabled flag, and status", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const get = route(routes, "GET", /lifecycle\$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
    const body = await res.json();
    expect(body.hasConfig).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.config).toEqual({ start: "make up", stop: "make down", health: "true" });
  });

  test("enable toggles the flag", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const enable = route(routes, "POST", /lifecycle\/enable\$/);
    const req = new Request(`http://x/api/projects/${id}/lifecycle/enable`, { method: "POST", body: JSON.stringify({ enabled: true }) });
    const res = await enable.handler(ctx(db, req, { id }) as never);
    expect((await res.json()).enabled).toBe(true);
  });

  test("start refuses when not enabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    const start = route(routes, "POST", /lifecycle\/start\$/);
    const res = await start.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle/start`, { method: "POST" }), { id }) as never);
    expect(res.status).toBe(400);
  });

  test("start runs the command when enabled", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps());
    // enable first
    const enable = route(routes, "POST", /lifecycle\/enable\$/);
    await enable.handler(ctx(db, new Request(`http://x/e`, { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
    const start = route(routes, "POST", /lifecycle\/start\$/);
    const res = await start.handler(ctx(db, new Request(`http://x/s`, { method: "POST" }), { id }) as never);
    const body = await res.json();
    expect(body.exitCode).toBe(0);
    expect(body.output).toBe("ok");
  });

  test("start refuses when the command is absent", async () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/p", name: "p" });
    const routes = lifecycleRoutes(deps({ readConfig: () => ({ stop: "make down" }) }));
    const enable = route(routes, "POST", /lifecycle\/enable\$/);
    await enable.handler(ctx(db, new Request(`http://x/e`, { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
    const start = route(routes, "POST", /lifecycle\/start\$/);
    const res = await start.handler(ctx(db, new Request(`http://x/s`, { method: "POST" }), { id }) as never);
    expect(res.status).toBe(400);
  });

  test("404 for an unknown project", async () => {
    const db = openDb(":memory:");
    const routes = lifecycleRoutes(deps());
    const get = route(routes, "GET", /lifecycle\$/);
    const res = await get.handler(ctx(db, new Request(`http://x/api/projects/nope/lifecycle`), { id: "nope" }) as never);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/routes-lifecycle.test.ts`
Expected: FAIL — cannot find module `../src/routes/lifecycle`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/routes/lifecycle.ts
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById, updateProject } from "../store/projects";
import { computeLifecycle } from "../lifecycle/status";
import type { ForestConfig } from "../lifecycle/config";
import type { LifecycleRegistry } from "../lifecycle/registry";
import type { RunResult } from "../lifecycle/run";

export type LifecycleRoutesDeps = {
  registry: LifecycleRegistry;
  readConfig: (path: string) => ForestConfig | null;
  runCommand: (cmd: string, cwd: string, opts: { timeoutMs: number }) => Promise<RunResult>;
};

const START_STOP_TIMEOUT_MS = 120_000;

function view(deps: LifecycleRoutesDeps, project: { id: string; path: string; lifecycleEnabled: boolean }) {
  const config = deps.readConfig(project.path);
  const transient = deps.registry.transient(project.id);
  const status =
    transient ??
    computeLifecycle({
      enabled: project.lifecycleEnabled,
      hasConfig: config !== null,
      servicesUp: false, // steady up/down comes from the scan snapshot, not this endpoint
      health: null,
    });
  return {
    hasConfig: config !== null,
    enabled: project.lifecycleEnabled,
    config,
    status,
    lastRun: deps.registry.lastRun(project.id),
  };
}

export function lifecycleRoutes(deps: LifecycleRoutesDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle$/,
      paramNames: ["id"],
      handler: (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json(view(deps, project));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle\/enable$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const body = (await ctx.request.json().catch(() => ({}))) as { enabled?: boolean };
        if (typeof body.enabled !== "boolean") return badRequest("enabled (boolean) is required");
        updateProject(ctx.db, project.id, { lifecycleEnabled: body.enabled });
        return json(view(deps, { ...project, lifecycleEnabled: body.enabled }));
      },
    },
    ...(["start", "stop"] as const).map((kind): Route => ({
      method: "POST",
      pattern: new RegExp(`^\\/api\\/projects\\/([^/]+)\\/lifecycle\\/${kind}$`),
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!project.lifecycleEnabled) return badRequest("lifecycle is not enabled for this project");
        if (deps.registry.inFlight(project.id)) return json({ error: "a lifecycle command is already running" }, { status: 409 });
        const config = deps.readConfig(project.path);
        const cmd = config?.[kind];
        if (!cmd) return badRequest(`no ${kind} command in forest.yaml`);

        deps.registry.setTransient(project.id, kind === "start" ? "starting" : "stopping");
        try {
          const result = await deps.runCommand(cmd, project.path, { timeoutMs: START_STOP_TIMEOUT_MS });
          const failed = result.exitCode !== 0 || result.timedOut;
          deps.registry.setLastRun(project.id, { kind, exitCode: result.exitCode, output: result.output, at: Date.now(), failed });
          return json({ exitCode: result.exitCode, output: result.output, timedOut: result.timedOut, failed });
        } finally {
          deps.registry.clearTransient(project.id);
          // Reconcile the card status quickly (start/stop changed what's running).
          await ctx.loop.refresh(project.id).catch(() => null);
        }
      },
    })),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test tests/routes-lifecycle.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lifecycle.ts server/tests/routes-lifecycle.test.ts
git commit -m "feat(lifecycle): enable/start/stop HTTP routes"
```

---

## Task 9: Wire into index.ts

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add imports**

Near the other scanner/route imports at the top of `server/src/index.ts`, add:

```ts
import { LifecycleRegistry } from "./lifecycle/registry";
import { readConfig } from "./lifecycle/config";
import { runCommand } from "./lifecycle/run";
import { augmentWithLifecycle } from "./lifecycle/augment";
import { PER_PROJECT_TIMEOUT_MS } from "./scanner/types";
import { getProjectByPath } from "./store/projects";
import { lifecycleRoutes } from "./routes/lifecycle";
```

- [ ] **Step 2: Construct the registry and a lifecycle-aware scan**

Replace the existing `createLoop({ ... })` block's `scanProject` line. First, just above `const loop = createLoop({`, add:

```ts
const lifecycleRegistry = new LifecycleRegistry();

async function scanProjectWithLifecycle(path: string) {
  const snap = await scanProject(path, probes);
  const project = getProjectByPath(db, path);
  const config = readConfig(path);
  return augmentWithLifecycle(snap, {
    enabled: project?.lifecycleEnabled ?? false,
    config,
    runHealth: async () => {
      const r = await runCommand(config!.health!, path, { timeoutMs: PER_PROJECT_TIMEOUT_MS });
      return { exitCode: r.exitCode };
    },
  });
}
```

Then change the loop's `scanProject` dependency from:

```ts
  scanProject: (path) => scanProject(path, probes),
```

to:

```ts
  scanProject: (path) => scanProjectWithLifecycle(path),
```

- [ ] **Step 3: Register the routes**

In the `routes: [ ... ]` array passed to `startServer`, add (e.g. after the `projectInfoRoutes({...})` block):

```ts
    ...lifecycleRoutes({ registry: lifecycleRegistry, readConfig, runCommand }),
```

- [ ] **Step 4: Smoke-test the whole server suite**

Run: `cd server && bun test`
Expected: PASS — all suites green (existing + the new lifecycle suites). If the integration test `server.integration.test.ts` snapshots a payload shape, confirm it tolerates the additive `lifecycle` field; it should, since it seeds via `emptySnapshot()`.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(lifecycle): wire lifecycle into scan loop and routes"
```

---

## Task 10: Web API client

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Extend the `Snapshot` type**

In `web/src/api.ts`, add a `lifecycle` field to the `Snapshot` type (after `errors: string[];`):

```ts
  lifecycle: {
    status: LifecycleStatus;
    hasConfig: boolean;
    enabled: boolean;
    health: { exitCode: number } | null;
  };
```

- [ ] **Step 2: Add the lifecycle types and API functions**

Add near the other exported types (e.g. after the `Snapshot` type):

```ts
export type LifecycleStatus =
  | "none" | "stopped" | "running" | "healthy" | "errors" | "starting" | "stopping";

export type LifecycleView = {
  hasConfig: boolean;
  enabled: boolean;
  config: { start?: string; stop?: string; health?: string } | null;
  status: LifecycleStatus;
  lastRun: { kind: "start" | "stop"; exitCode: number; output: string; at: number; failed: boolean } | null;
};

export type LifecycleRunResult = { exitCode: number; output: string; timedOut: boolean; failed: boolean };

export async function fetchLifecycle(id: string): Promise<LifecycleView> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle`), "fetch lifecycle");
}

export async function setLifecycleEnabled(id: string, enabled: boolean): Promise<LifecycleView> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
    "enable lifecycle",
  );
}

export async function startLifecycle(id: string): Promise<LifecycleRunResult> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle/start`, { method: "POST" }), "start lifecycle");
}

export async function stopLifecycle(id: string): Promise<LifecycleRunResult> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle/stop`, { method: "POST" }), "stop lifecycle");
}
```

- [ ] **Step 3: Verify web type-check / build**

Run: `cd web && bun run build`
Expected: builds without type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(lifecycle): web api client for lifecycle endpoints"
```

---

## Task 11: color-by dimension

**Files:**
- Modify: `web/src/lib/colorBy.ts`
- Test: `web/tests/colorBy-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/colorBy-lifecycle.test.ts
import { describe, expect, test } from "vitest";
import { bandColor, legend, COLOR_BY_DIMENSIONS } from "../src/lib/colorBy";
import { themes } from "../src/lib/themes";
import type { ProjectRow } from "../src/api";

const theme = themes[0];

function proj(status: string): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: null,
      services: { docker: [], processes: [] },
      errors: [],
      lifecycle: { status: status as never, hasConfig: true, enabled: true, health: null },
    },
  } as ProjectRow;
}

describe("lifecycle color-by", () => {
  test("is a registered dimension", () => {
    expect(COLOR_BY_DIMENSIONS).toContain("lifecycle");
  });

  test("healthy uses the ok color, errors the error color, stopped is neutral", () => {
    const healthy = bandColor(proj("healthy"), "lifecycle", [], theme, Date.now());
    const errors = bandColor(proj("errors"), "lifecycle", [], theme, Date.now());
    const stopped = bandColor(proj("stopped"), "lifecycle", [], theme, Date.now());
    expect(healthy.neutral).toBe(false);
    expect(errors.neutral).toBe(false);
    expect(stopped.neutral).toBe(true);
  });

  test("legend has entries for the lifecycle dimension", () => {
    expect(legend("lifecycle", [], theme).length).toBeGreaterThan(0);
  });
});
```

Note: confirm the exact import path for the theme list (`../src/lib/themes`) and that `themes[0]` is a valid `Theme`; adjust to the real export (e.g. `import { themes } from "../src/lib/themes"` vs a map) if the build complains.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/colorBy-lifecycle.test.ts`
Expected: FAIL — `"lifecycle"` is not in the union / not handled.

- [ ] **Step 3: Extend `colorBy.ts`**

In `web/src/lib/colorBy.ts`:

Change the union and list:
```ts
export type ColorByDimension = "git" | "heat" | "services" | "agents" | "lifecycle" | "group" | "none";

export const COLOR_BY_DIMENSIONS: ColorByDimension[] = [
  "git", "heat", "services", "agents", "lifecycle", "group", "none",
];
```

In `hueFor`, add a branch before the final `exhaustive` guard (after the `heat` block), using the snapshot already fetched above it:
```ts
  if (dim === "lifecycle") {
    switch (snap.lifecycle.status) {
      case "healthy": return t.ok;
      case "running": return t.info;
      case "errors": return t.error;
      case "starting":
      case "stopping": return t.warn;
      default: return null; // none / stopped
    }
  }
```

In `legend`, add a `case` (before the closing brace of the switch):
```ts
    case "lifecycle":
      return [
        { label: "healthy", swatch: t.ok },
        { label: "running", swatch: t.info },
        { label: "errors", swatch: t.error },
        { label: "stopped", swatch: t.bg3 },
      ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/colorBy-lifecycle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/colorBy.ts web/tests/colorBy-lifecycle.test.ts
git commit -m "feat(lifecycle): lifecycle color-by dimension"
```

---

## Task 12: card chip

**Files:**
- Modify: `web/src/lib/dashboard-view.ts`, `web/src/styles.css`
- Test: `web/tests/dashboard-view-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/dashboard-view-lifecycle.test.ts
import { describe, expect, test } from "vitest";
import { statusChips } from "../src/lib/dashboard-view";
import type { ProjectRow } from "../src/api";

function proj(status: string, hasConfig = true, enabled = true): ProjectRow {
  return {
    id: "p", name: "p", path: "/p", pinned: false, hidden: false, group: null,
    scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
    snapshot: {
      git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
      lastEdit: null,
      services: { docker: [], processes: [] },
      errors: [],
      lifecycle: { status: status as never, hasConfig, enabled, health: null },
    },
  } as ProjectRow;
}

describe("lifecycle chip", () => {
  test("healthy shows a running-tone chip", () => {
    const chip = statusChips(proj("healthy"), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip?.tone).toBe("running");
    expect(chip?.label).toBe("healthy");
  });

  test("errors shows an error-tone chip", () => {
    const chip = statusChips(proj("errors"), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip?.tone).toBe("error");
  });

  test("status 'none' shows no lifecycle chip", () => {
    const chip = statusChips(proj("none", false, false), Date.now()).find((c) => c.key === "lifecycle");
    expect(chip).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/dashboard-view-lifecycle.test.ts`
Expected: FAIL — no `lifecycle` chip / `"error"` not an allowed tone.

- [ ] **Step 3: Add the `error` tone and the chip**

In `web/src/lib/dashboard-view.ts`, extend `ChipTone`:
```ts
export type ChipTone =
  | "neutral" | "dirty" | "ahead" | "behind" | "running" | "agent" | "bare" | "error";
```

In `statusChips`, add this block just before the final age chip is pushed (before `chips.push({ key: "age", ... })`):
```ts
  const lc = p.snapshot?.lifecycle;
  if (lc && lc.status !== "none") {
    const toneByStatus: Record<string, ChipTone> = {
      healthy: "running",
      running: "running",
      errors: "error",
      stopped: "neutral",
      starting: "neutral",
      stopping: "neutral",
    };
    chips.push({
      key: "lifecycle",
      label: lc.status,
      tone: toneByStatus[lc.status] ?? "neutral",
      title: "forest.yaml lifecycle",
    });
  }
```

- [ ] **Step 4: Add the CSS tone**

In `web/src/styles.css`, after the `.chip-behind` rule (line ~138), add:
```css
.chip-error  { color: var(--error); border-color: color-mix(in srgb, var(--error) 40%, transparent); background: color-mix(in srgb, var(--error) 8%, transparent); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/dashboard-view-lifecycle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/dashboard-view.ts web/src/styles.css web/tests/dashboard-view-lifecycle.test.ts
git commit -m "feat(lifecycle): lifecycle status chip on cards"
```

---

## Task 13: Lifecycle panel component

**Files:**
- Create: `web/src/components/LifecyclePanel.tsx`
- Modify: `web/src/pages/ProjectDetail.tsx`
- Test: `web/tests/LifecyclePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/LifecyclePanel.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import LifecyclePanel from "../src/components/LifecyclePanel";
import * as api from "../src/api";

describe("LifecyclePanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("shows an enable action when a forest.yaml is present but disabled", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: false, config: { start: "make up" }, status: "none", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" projectPath="/p" />);
    expect(await screen.findByRole("button", { name: /enable lifecycle/i })).toBeTruthy();
  });

  test("shows Start/Stop when enabled with commands", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up", stop: "make down" }, status: "stopped", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" projectPath="/p" />);
    expect(await screen.findByRole("button", { name: /^start$/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^stop$/i })).toBeTruthy();
  });

  test("hint when there is no forest.yaml", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: false, enabled: false, config: null, status: "none", lastRun: null,
    });
    render(() => <LifecyclePanel projectId="p" projectPath="/p" />);
    expect(await screen.findByText(/forest\.yaml/i)).toBeTruthy();
  });

  test("clicking Start calls the api", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped", lastRun: null,
    });
    const start = vi.spyOn(api, "startLifecycle").mockResolvedValue({ exitCode: 0, output: "ok", timedOut: false, failed: false });
    render(() => <LifecyclePanel projectId="p" projectPath="/p" />);
    fireEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("p"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/LifecyclePanel.test.tsx`
Expected: FAIL — cannot find module `../src/components/LifecyclePanel`.

- [ ] **Step 3: Write the component**

```tsx
// web/src/components/LifecyclePanel.tsx
import { Show, createResource, createSignal } from "solid-js";
import {
  fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle,
  type LifecycleView,
} from "../api";

export default function LifecyclePanel(props: { projectId: string; projectPath: string }) {
  const [data, { refetch }] = createResource<LifecycleView>(() => fetchLifecycle(props.projectId));
  const [busy, setBusy] = createSignal(false);
  const [output, setOutput] = createSignal<string | null>(null);

  const enable = async () => { setBusy(true); try { await setLifecycleEnabled(props.projectId, true); await refetch(); } finally { setBusy(false); } };
  const run = async (fn: (id: string) => Promise<{ output: string; failed: boolean }>) => {
    setBusy(true);
    try {
      const r = await fn(props.projectId);
      setOutput(r.output || "(no output)");
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="lifecycle-panel">
      <Show when={data()} fallback={<span class="muted">lifecycle…</span>}>
        {(d) => (
          <>
            <span class={`chip chip-lifecycle chip-${d().status}`} title="forest.yaml lifecycle">{d().status}</span>

            <Show when={!d().hasConfig}>
              <span class="muted">No <code>forest.yaml</code> — add one with <code>start</code>/<code>stop</code>/<code>health</code> to enable lifecycle controls.</span>
            </Show>

            <Show when={d().hasConfig && !d().enabled}>
              <button class="btn" disabled={busy()} onclick={enable}>Enable lifecycle</button>
            </Show>

            <Show when={d().enabled}>
              <Show when={d().config?.start}>
                <button class="btn" disabled={busy()} onclick={() => run(startLifecycle)}>Start</button>
              </Show>
              <Show when={d().config?.stop}>
                <button class="btn" disabled={busy()} onclick={() => run(stopLifecycle)}>Stop</button>
              </Show>
            </Show>

            <Show when={output() ?? d().lastRun?.output}>
              {(out) => (
                <details open={d().lastRun?.failed ?? false} class="lifecycle-output">
                  <summary>last run</summary>
                  <pre>{out()}</pre>
                </details>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/LifecyclePanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Render it in ProjectDetail**

In `web/src/pages/ProjectDetail.tsx`, add the import near the other component imports:
```ts
import LifecyclePanel from "../components/LifecyclePanel";
```

In the JSX, inside the `<Show when={project()}>` that renders `<ProjectHeader project={p()} />`, add the panel right after the header:
```tsx
        {(p) => (
          <>
            <ProjectHeader project={p()} />
            <LifecyclePanel projectId={p().id} projectPath={p().path} />
          </>
        )}
```

(Adjust the existing `{(p) => <ProjectHeader project={p()} />}` arrow to the fragment form above.)

- [ ] **Step 6: Build to confirm it wires up**

Run: `cd web && bun run build`
Expected: builds cleanly.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/LifecyclePanel.tsx web/src/pages/ProjectDetail.tsx web/tests/LifecyclePanel.test.tsx
git commit -m "feat(lifecycle): lifecycle panel on the project detail page"
```

---

## Task 14: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a lifecycle section**

In `README.md`, add a new section after the "Dashboard cards" section (before "### Theming"):

```markdown
### Project lifecycle (`forest.yaml`)

Drop a `forest.yaml` at a project's repo root to teach Forest how to launch,
stop, and health-check it:

​```yaml
# forest.yaml
start:  docker compose up -d          # required for a Start button
stop:   docker compose down           # required for a Stop button
health: curl -fsS localhost:3000/up   # optional; exit 0 = healthy, nonzero = errors
​```

Each value is a single shell command run from the project directory. Ask Claude
or Codex to write this file for you — "add a forest.yaml that starts and stops
this project."

The file is **inert until you enable lifecycle** for that project (a one-click
**Enable lifecycle** button on the project page). This is the security boundary:
Forest scans every repo under your scan root, so no discovered `forest.yaml`
runs anything until you opt it in.

Once enabled, the project page gets **Start** / **Stop** buttons, and Forest
reports a **lifecycle** status you can color cards by (the dashboard **color by**
dropdown):

- **stopped** — nothing running.
- **running** — something is up (no health command to judge it).
- **healthy** — up and the `health` command exits 0.
- **errors** — up but the `health` command exits nonzero.

"Up" is decided by Forest's existing container/process detection, and the health
command only runs on a project that's already up.
```

(The `​` zero-width marks above denote the fenced code block — write real triple backticks.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document forest.yaml project lifecycle"
```

---

## Task 15: Full suite verification

- [ ] **Step 1: Run the whole server suite**

Run: `cd server && bun test`
Expected: PASS — all suites, including the six new lifecycle suites.

- [ ] **Step 2: Run the whole web suite**

Run: `cd web && bun run test`
Expected: PASS — all suites, including the three new lifecycle suites.

- [ ] **Step 3: Build the web app**

Run: `bun run build:web`
Expected: builds without type errors.

- [ ] **Step 4: Final commit (if anything was left uncommitted)**

```bash
git status
# commit any stragglers under a descriptive message
```

---

## Self-Review Notes

- **Spec coverage:** file schema (Task 1, 14), status model (Task 2, 7, 11, 12), one-shot execution (Task 3), opt-in gate (Task 6, 8, 13), buttons + panel (Task 13), color-by + chip (Task 11, 12), routes + storage (Task 6, 8, 9), tests throughout, README (Task 14). All spec sections map to a task.
- **Deviation (documented):** `start-failed`/`stop-failed` are represented as `lastRun.failed` + panel output rather than distinct card statuses — see the Status note in the header.
- **Type consistency:** `LifecycleStatus` (`server/src/lifecycle/status.ts`) and the web mirror in `api.ts` share the same seven-member union; `ForestConfig` keys (`start`/`stop`/`health`) are consistent across config, routes, augment, and the web `config` shape; `updateProject` uses `lifecycleEnabled` end-to-end.
- **Verify-before-code checks flagged inline:** `Bun.YAML` availability (Task 1), the theme-list import path in web tests (Task 11), and that the integration test tolerates the additive `lifecycle` field (Task 9).
```
