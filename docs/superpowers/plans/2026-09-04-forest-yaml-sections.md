# forest.yaml Named Lifecycle Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named `sections:` to `forest.yaml` so a project can start/stop/link to several independent things (e.g. a Godot editor at the top level and the game as a section), each with its own optional `start`/`stop`/`health`/`url`.

**Architecture:** The top-level lifecycle is untouched (scanner-backed status). Sections are additive: parsed into `ForestConfig.sections`, tracked per-target in the in-memory registry, driven by new per-section start/stop routes, and given a live status (computed in the GET route by running each section's `health` command — `healthy`/`stopped`, or `none` when it has no health). All section UI lives in the detail `LifecyclePanel`; the dashboard card is unchanged.

**Tech Stack:** Bun + TypeScript (server, `bun test`), SolidJS + Vitest (web), Bun.YAML for parsing.

**Spec:** `docs/superpowers/specs/2026-09-04-forest-yaml-sections-design.md`

---

## File Structure

- `server/src/lifecycle/config.ts` — add `LifecycleSection` type, `sections` on `ForestConfig`, and section parsing.
- `server/src/lifecycle/status.ts` — add pure `computeSectionStatus` helper.
- `server/src/lifecycle/registry.ts` — key transient + last-run per target (top-level or named section).
- `server/src/routes/lifecycle.ts` — section start/stop routes; GET view gains `sections`.
- `web/src/api.ts` — extend `LifecycleView` with `sections`; add `startSection`/`stopSection`.
- `web/src/components/LifecyclePanel.tsx` — render the section list.
- `skills/forest-yaml/SKILL.md` — document `sections:` + Godot example.
- Tests alongside each (`server/tests/*`, `web/tests/*`).

---

## Task 1: Parse `sections` in the config

**Files:**
- Modify: `server/src/lifecycle/config.ts`
- Test: `server/tests/lifecycle-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("readConfig", …)` block in `server/tests/lifecycle-config.test.ts`:

```ts
test("parses a sections map with per-section keys", () => {
  const dir = tmpProject(
    "start: godot --editor .\n" +
    "sections:\n" +
    "  game:\n" +
    "    start: godot .\n" +
    "    stop: pkill -f godot\n" +
    "    url: http://localhost:8060\n" +
    "    health: pgrep -f godot\n",
  );
  expect(readConfig(dir)).toEqual({
    start: "godot --editor .",
    sections: {
      game: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" },
    },
  });
});

test("a sections-only forest.yaml is a valid config", () => {
  const dir = tmpProject("sections:\n  game:\n    start: godot .\n");
  expect(readConfig(dir)).toEqual({ sections: { game: { start: "godot ." } } });
});

test("drops a section with no usable keys", () => {
  const dir = tmpProject("start: make up\nsections:\n  empty:\n    name: nope\n");
  expect(readConfig(dir)).toEqual({ start: "make up" });
});

test("drops a section's non-http(s) url but keeps its commands", () => {
  const dir = tmpProject('sections:\n  game:\n    start: godot .\n    url: "javascript:alert(1)"\n');
  expect(readConfig(dir)).toEqual({ sections: { game: { start: "godot ." } } });
});

test("ignores a non-object sections value", () => {
  const dir = tmpProject("start: make up\nsections: nope\n");
  expect(readConfig(dir)).toEqual({ start: "make up" });
});

test("normalizes an all-dropped sections map to no sections key", () => {
  const dir = tmpProject("start: make up\nsections:\n  empty:\n    name: nope\n");
  expect(readConfig(dir)).not.toHaveProperty("sections");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/lifecycle-config.test.ts`
Expected: FAIL — the new `sections`-related tests fail (parser ignores `sections` today).

- [ ] **Step 3: Implement section parsing**

Replace the full contents of `server/src/lifecycle/config.ts` with:

```ts
// server/src/lifecycle/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LifecycleSection = {
  start?: string;
  stop?: string;
  health?: string;
  url?: string;
};

export type ForestConfig = {
  start?: string;
  stop?: string;
  health?: string;
  url?: string;
  sections?: Record<string, LifecycleSection>;
};

const COMMAND_KEYS = ["start", "stop", "health", "url"] as const;

/**
 * Pull the recognised string keys out of one object (top level or a section).
 * Trims, drops empty strings, and drops a `url` whose scheme isn't http(s) (it's
 * rendered as an href). Returns the keys that survived — possibly none.
 */
function readSection(obj: Record<string, unknown>): LifecycleSection {
  const out: LifecycleSection = {};
  for (const key of COMMAND_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  if (out.url !== undefined && !/^https?:\/\//i.test(out.url)) delete out.url;
  return out;
}

function hasAnyKey(sec: LifecycleSection): boolean {
  return sec.start !== undefined || sec.stop !== undefined || sec.health !== undefined || sec.url !== undefined;
}

/**
 * Read and parse `<projectPath>/forest.yaml`. Tolerant: a missing or malformed
 * file, or one with no recognised content, returns null. Reads top-level
 * `start`/`stop`/`health`/`url` (each a string) plus an optional `sections` map
 * of the same shape; everything else is ignored.
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

  const cfg: ForestConfig = readSection(obj);

  const rawSections = obj.sections;
  if (rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)) {
    const sections: Record<string, LifecycleSection> = {};
    for (const [name, value] of Object.entries(rawSections as Record<string, unknown>)) {
      if (typeof name !== "string" || name.trim() === "") continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const sec = readSection(value as Record<string, unknown>);
      if (hasAnyKey(sec)) sections[name] = sec;
    }
    if (Object.keys(sections).length > 0) cfg.sections = sections;
  }

  if (!hasAnyKey(cfg) && cfg.sections === undefined) return null;
  return cfg;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/lifecycle-config.test.ts`
Expected: PASS — all existing and new tests pass (top-level behaviour is unchanged; `readSection` reproduces it).

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/config.ts server/tests/lifecycle-config.test.ts
git commit -m "feat(lifecycle): parse named sections in forest.yaml"
```

---

## Task 2: Pure section-status helper

**Files:**
- Modify: `server/src/lifecycle/status.ts`
- Test: `server/tests/lifecycle-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/lifecycle-status.test.ts` (import `computeSectionStatus` from `../src/lifecycle/status` alongside the existing import):

```ts
import { computeSectionStatus } from "../src/lifecycle/status";

describe("computeSectionStatus", () => {
  test("no health command → none (a launcher has no steady-state chip)", () => {
    expect(computeSectionStatus({ hasHealth: false, health: null })).toBe("none");
  });
  test("health defined but not run → none", () => {
    expect(computeSectionStatus({ hasHealth: true, health: null })).toBe("none");
  });
  test("health exit 0 → healthy", () => {
    expect(computeSectionStatus({ hasHealth: true, health: { exitCode: 0 } })).toBe("healthy");
  });
  test("health nonzero → stopped (health is the up-probe for a section)", () => {
    expect(computeSectionStatus({ hasHealth: true, health: { exitCode: 1 } })).toBe("stopped");
  });
});
```

If `lifecycle-status.test.ts` already imports from `../src/lifecycle/status`, merge the named import rather than adding a duplicate import line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/lifecycle-status.test.ts`
Expected: FAIL — `computeSectionStatus` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `server/src/lifecycle/status.ts` (after `computeLifecycle`):

```ts
export type SectionStatusInput = {
  hasHealth: boolean;
  health: { exitCode: number } | null;
};

/**
 * Pure: a section's status from its health probe. A section has no independent
 * up-detection, so health *is* the up-probe: exit 0 → healthy, nonzero →
 * stopped. A section with no health command (or one not yet run) has no
 * observable steady-state → `none`. Transient starting/stopping is owned by the
 * registry and applied by the caller, not here.
 */
export function computeSectionStatus(input: SectionStatusInput): LifecycleStatus {
  if (!input.hasHealth || input.health === null) return "none";
  return input.health.exitCode === 0 ? "healthy" : "stopped";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/lifecycle-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/status.ts server/tests/lifecycle-status.test.ts
git commit -m "feat(lifecycle): pure section-status helper"
```

---

## Task 3: Per-target registry keying

**Files:**
- Modify: `server/src/lifecycle/registry.ts`
- Test: `server/tests/lifecycle-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/lifecycle-registry.test.ts` inside the existing `describe`:

```ts
test("keys transient state per section, independent of the top level", () => {
  const reg = new LifecycleRegistry();
  reg.setTransient("p1", "starting", "game");
  expect(reg.transient("p1", "game")).toBe("starting");
  expect(reg.transient("p1")).toBeNull();          // top level unaffected
  expect(reg.transient("p1", "editor")).toBeNull(); // other section unaffected
  expect(reg.inFlight("p1", "game")).toBe(true);
  expect(reg.inFlight("p1")).toBe(false);
  reg.clearTransient("p1", "game");
  expect(reg.transient("p1", "game")).toBeNull();
});

test("keys last-run per section", () => {
  const reg = new LifecycleRegistry();
  const run = { kind: "start", exitCode: 0, output: "up", at: 1, failed: false } as const;
  reg.setLastRun("p1", run, "game");
  expect(reg.lastRun("p1", "game")).toEqual(run);
  expect(reg.lastRun("p1")).toBeNull(); // top level has its own slot
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/lifecycle-registry.test.ts`
Expected: FAIL — the methods don't accept a `section` argument yet (transient stored under `"p1"` regardless of section).

- [ ] **Step 3: Implement per-target keying**

Replace the full contents of `server/src/lifecycle/registry.ts` with:

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

/**
 * In-memory only: transient start/stop state and the last run's captured output,
 * keyed per *target*. A target is either the top-level lifecycle (no `section`)
 * or a named section. Section state is independent of the top level and of
 * other sections, so starting one section never blocks another.
 */
export class LifecycleRegistry {
  private map = new Map<string, Entry>();

  private key(id: string, section?: string): string {
    return section === undefined ? id : `${id} ${section}`;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/lifecycle-registry.test.ts`
Expected: PASS — existing top-level tests (calls with no `section`) still pass because the key for `section === undefined` is exactly `id`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lifecycle/registry.ts server/tests/lifecycle-registry.test.ts
git commit -m "feat(lifecycle): key registry state per target (top level or section)"
```

---

## Task 4: Section start/stop routes + `sections` in the GET view

**Files:**
- Modify: `server/src/routes/lifecycle.ts`
- Test: `server/tests/routes-lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

The existing test helper `deps()` returns a `readConfig` with no sections. Add a sectioned override and new tests to `server/tests/routes-lifecycle.test.ts`. Add a small helper near the top (after the `route` helper) and enable-then-call helper inline in each test:

```ts
const sectionedConfig = () => ({
  start: "make up",
  sections: {
    game: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" },
    editor: { start: "godot --editor ." }, // launcher, no health
  },
});

async function enable(routes: ReturnType<typeof lifecycleRoutes>, db: ReturnType<typeof openDb>, id: string) {
  const e = route(routes, "POST", /lifecycle\/enable$/);
  await e.handler(ctx(db, new Request("http://x/e", { method: "POST", body: JSON.stringify({ enabled: true }) }), { id }) as never);
}
```

Then the tests:

```ts
test("GET view includes sections with computed status and lastRun", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  // health "pgrep -f godot" → exit 0 (healthy); editor has no health → none
  const runCommand = async (cmd: string) => ({ exitCode: cmd.includes("pgrep") ? 0 : 0, output: "", timedOut: false });
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
  const get = route(routes, "GET", /lifecycle$/);
  const res = await get.handler(ctx(db, new Request(`http://x/api/projects/${id}/lifecycle`), { id }) as never);
  const body = await res.json();
  const byName = Object.fromEntries(body.sections.map((s: { name: string }) => [s.name, s]));
  expect(byName.game.status).toBe("healthy");
  expect(byName.game.config.url).toBe("http://localhost:8060");
  expect(byName.editor.status).toBe("none");
});

test("section status reflects a nonzero health as stopped", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  const runCommand = async () => ({ exitCode: 1, output: "", timedOut: false });
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig, runCommand }));
  const get = route(routes, "GET", /lifecycle$/);
  const res = await get.handler(ctx(db, new Request(`http://x/g`), { id }) as never);
  const body = await res.json();
  const game = body.sections.find((s: { name: string }) => s.name === "game");
  expect(game.status).toBe("stopped");
});

test("section start runs the section command when enabled", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
  await enable(routes, db, id);
  const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
  const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
  const body = await res.json();
  expect(body.exitCode).toBe(0);
  expect(body.output).toBe("ok");
});

test("section start 404s for an unknown section", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
  await enable(routes, db, id);
  const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
  const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "nope" }) as never);
  expect(res.status).toBe(404);
});

test("section start 400s when the section lacks a start command", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  // editor has only a start; use stop to hit the missing-command path
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
  await enable(routes, db, id);
  const stop = route(routes, "POST", /sections\/([^/]+)\/stop$/);
  const res = await stop.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "editor" }) as never);
  expect(res.status).toBe(400);
});

test("section start 400s when lifecycle is disabled", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  const routes = lifecycleRoutes(deps({ readConfig: sectionedConfig }));
  const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
  const res = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
  expect(res.status).toBe(400);
});

test("a section in flight 409s only that section, not another", async () => {
  const db = openDb(":memory:");
  const id = upsertProject(db, { path: "/tmp/p", name: "p" });
  const d = deps({ readConfig: sectionedConfig });
  const routes = lifecycleRoutes(d);
  await enable(routes, db, id);
  d.registry.setTransient(id, "starting", "game"); // game busy
  const start = route(routes, "POST", /sections\/([^/]+)\/start$/);
  const busy = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "game" }) as never);
  expect(busy.status).toBe(409);
  const other = await start.handler(ctx(db, new Request("http://x/s", { method: "POST" }), { id, section: "editor" }) as never);
  expect(other.status).toBe(200);
});
```

Note: the `route()` helper matches by substring of the pattern `source`. The section route source contains `sections\/([^/]+)\/start`, so match with `/sections\/([^/]+)\/start$/`. The existing top-level `route(routes, "POST", /lifecycle\/start$/)` still matches only the top-level route (the section source does not contain `lifecycle\/start$`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test tests/routes-lifecycle.test.ts`
Expected: FAIL — no `sections` in the GET body and no section routes registered.

- [ ] **Step 3: Implement the routes and view**

Replace the full contents of `server/src/routes/lifecycle.ts` with:

```ts
// server/src/routes/lifecycle.ts
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById, updateProject } from "../store/projects";
import { getSnapshotByProjectId } from "../store/snapshots";
import { computeLifecycle, computeSectionStatus } from "../lifecycle/status";
import type { LifecycleStatus } from "../lifecycle/status";
import type { ForestConfig, LifecycleSection } from "../lifecycle/config";
import type { LifecycleRegistry, LastRun } from "../lifecycle/registry";
import type { RunResult } from "../lifecycle/run";

export type LifecycleRoutesDeps = {
  registry: LifecycleRegistry;
  readConfig: (path: string) => ForestConfig | null;
  runCommand: (cmd: string, cwd: string, opts: { timeoutMs: number }) => Promise<RunResult>;
};

const START_STOP_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

type SectionView = {
  name: string;
  config: LifecycleSection;
  status: LifecycleStatus;
  lastRun: LastRun | null;
};

/**
 * Live status for one section: its registry transient if a command is running,
 * otherwise its health probe (`healthy`/`stopped`), or `none` when it has no
 * health command. Health runs here (not at scan time) so the polled panel sees
 * fresh status without touching the scanner or the dashboard card.
 */
async function sectionView(
  deps: LifecycleRoutesDeps,
  projectId: string,
  projectPath: string,
  name: string,
  section: LifecycleSection,
): Promise<SectionView> {
  const transient = deps.registry.transient(projectId, name);
  let status: LifecycleStatus;
  if (transient) {
    status = transient;
  } else if (section.health) {
    let health: { exitCode: number } | null;
    try {
      const r = await deps.runCommand(section.health, projectPath, { timeoutMs: HEALTH_TIMEOUT_MS });
      health = { exitCode: r.exitCode };
    } catch {
      health = { exitCode: 1 };
    }
    status = computeSectionStatus({ hasHealth: true, health });
  } else {
    status = computeSectionStatus({ hasHealth: false, health: null });
  }
  return { name, config: section, status, lastRun: deps.registry.lastRun(projectId, name) };
}

async function view(
  deps: LifecycleRoutesDeps,
  db: import("bun:sqlite").Database,
  project: { id: string; path: string; lifecycleEnabled: boolean },
) {
  const config = deps.readConfig(project.path);
  const transient = deps.registry.transient(project.id);
  const stored = getSnapshotByProjectId(db, project.id);
  const status =
    transient ??
    stored?.snapshot.lifecycle?.status ??
    computeLifecycle({
      enabled: project.lifecycleEnabled,
      hasConfig: config !== null,
      servicesUp: false, // no snapshot yet — best-effort until the first scan
      health: null,
    });

  const sectionEntries = Object.entries(config?.sections ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const sections = await Promise.all(
    sectionEntries.map(([name, sec]) => sectionView(deps, project.id, project.path, name, sec)),
  );

  return {
    hasConfig: config !== null,
    enabled: project.lifecycleEnabled,
    config,
    status,
    lastRun: deps.registry.lastRun(project.id),
    sections,
  };
}

export function lifecycleRoutes(deps: LifecycleRoutesDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/lifecycle$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        return json(await view(deps, ctx.db, project));
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
        await ctx.loop.refresh(project.id).catch(() => null);
        return json(await view(deps, ctx.db, { ...project, lifecycleEnabled: body.enabled }));
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
          await ctx.loop.refresh(project.id).catch(() => null);
        }
      },
    })),
    ...(["start", "stop"] as const).map((kind): Route => ({
      method: "POST",
      pattern: new RegExp(`^\\/api\\/projects\\/([^/]+)\\/lifecycle\\/sections\\/([^/]+)\\/${kind}$`),
      paramNames: ["id", "section"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        if (!project.lifecycleEnabled) return badRequest("lifecycle is not enabled for this project");
        const name = ctx.params.section!;
        const config = deps.readConfig(project.path);
        const section = config?.sections?.[name];
        if (!section) return notFound();
        if (deps.registry.inFlight(project.id, name)) return json({ error: "a lifecycle command is already running for this section" }, { status: 409 });
        const cmd = section[kind];
        if (!cmd) return badRequest(`no ${kind} command in section '${name}'`);

        deps.registry.setTransient(project.id, kind === "start" ? "starting" : "stopping", name);
        try {
          const result = await deps.runCommand(cmd, project.path, { timeoutMs: START_STOP_TIMEOUT_MS });
          const failed = result.exitCode !== 0 || result.timedOut;
          deps.registry.setLastRun(project.id, { kind, exitCode: result.exitCode, output: result.output, at: Date.now(), failed }, name);
          return json({ exitCode: result.exitCode, output: result.output, timedOut: result.timedOut, failed });
        } finally {
          deps.registry.clearTransient(project.id, name);
          await ctx.loop.refresh(project.id).catch(() => null);
        }
      },
    })),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test tests/routes-lifecycle.test.ts`
Expected: PASS — the whole file, including the pre-existing top-level tests (the GET body now also has `sections: []` when there are none, which the old assertions ignore).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lifecycle.ts server/tests/routes-lifecycle.test.ts
git commit -m "feat(lifecycle): section start/stop routes and live section status in the view"
```

---

## Task 5: Client API — `sections` in the view + section start/stop

**Files:**
- Modify: `web/src/api.ts`
- Test: (covered by Task 6's panel tests — no separate api test file exists)

- [ ] **Step 1: Extend the `LifecycleView` type**

In `web/src/api.ts`, replace the `LifecycleView` type with:

```ts
export type LifecycleSectionView = {
  name: string;
  config: { start?: string; stop?: string; health?: string; url?: string };
  status: LifecycleStatus;
  lastRun: { kind: "start" | "stop"; exitCode: number; output: string; at: number; failed: boolean } | null;
};

export type LifecycleView = {
  hasConfig: boolean;
  enabled: boolean;
  config: { start?: string; stop?: string; health?: string; url?: string; sections?: Record<string, { start?: string; stop?: string; health?: string; url?: string }> } | null;
  status: LifecycleStatus;
  lastRun: { kind: "start" | "stop"; exitCode: number; output: string; at: number; failed: boolean } | null;
  sections?: LifecycleSectionView[];
};
```

- [ ] **Step 2: Add section start/stop wrappers**

In `web/src/api.ts`, immediately after the existing `stopLifecycle` function, add:

```ts
export async function startSection(id: string, section: string): Promise<LifecycleRunResult> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle/sections/${encodeURIComponent(section)}/start`, { method: "POST" }),
    "start section",
  );
}

export async function stopSection(id: string, section: string): Promise<LifecycleRunResult> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(id)}/lifecycle/sections/${encodeURIComponent(section)}/stop`, { method: "POST" }),
    "stop section",
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS — no type errors (existing `LifecyclePanel` still compiles because `sections` is optional).

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(web): lifecycle view sections type and section start/stop api"
```

---

## Task 6: Render sections in the LifecyclePanel

**Files:**
- Modify: `web/src/components/LifecyclePanel.tsx`
- Test: `web/tests/LifecyclePanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/LifecyclePanel.test.tsx` inside the existing `describe`:

```ts
test("renders a section row with a status chip and Start/Stop", async () => {
  vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
    hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
    sections: [
      { name: "game", config: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" }, status: "healthy", lastRun: null },
    ],
  });
  render(() => <LifecyclePanel projectId="p" />);
  expect(await screen.findByText("game")).toBeTruthy();
  expect(await screen.findByText("healthy")).toBeTruthy();
  // section-scoped Start/Stop buttons exist in addition to the top-level Start
  expect((await screen.findAllByRole("button", { name: /^start$/i })).length).toBeGreaterThanOrEqual(2);
});

test("hides the chip for a launcher section with status none", async () => {
  vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
    hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
    sections: [
      { name: "editor", config: { start: "godot --editor ." }, status: "none", lastRun: null },
    ],
  });
  render(() => <LifecyclePanel projectId="p" />);
  expect(await screen.findByText("editor")).toBeTruthy();
  // "none" must not be rendered as a chip label
  expect(screen.queryByText("none")).toBeNull();
});

test("clicking a section Start calls startSection with the section name", async () => {
  vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
    hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
    sections: [
      { name: "game", config: { start: "godot ." }, status: "none", lastRun: null },
    ],
  });
  const startSection = vi.spyOn(api, "startSection").mockResolvedValue({ exitCode: 0, output: "ok", timedOut: false, failed: false });
  render(() => <LifecyclePanel projectId="p" />);
  // the only Start button here belongs to the section (top-level has no start… it does: "make up").
  const buttons = await screen.findAllByRole("button", { name: /^start$/i });
  fireEvent.click(buttons[buttons.length - 1]); // the section's Start (rendered after the top-level block)
  await waitFor(() => expect(startSection).toHaveBeenCalledWith("p", "game"));
});

test("shows a section Open link for a healthy section with a url", async () => {
  vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
    hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
    sections: [
      { name: "game", config: { start: "godot .", url: "http://localhost:8060", health: "pgrep -f godot" }, status: "healthy", lastRun: null },
    ],
  });
  render(() => <LifecyclePanel projectId="p" />);
  const links = await screen.findAllByRole("link", { name: /open/i });
  expect(links.some((l) => (l as HTMLAnchorElement).href.includes("localhost:8060"))).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun run test -- LifecyclePanel`
Expected: FAIL — the panel doesn't render sections yet.

- [ ] **Step 3: Implement the section list**

In `web/src/components/LifecyclePanel.tsx`:

1. Extend the imports to include the section api + `For`:

```ts
import { Show, For, createResource, createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import { fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle, startSection, stopSection } from "../api";
import type { LifecycleStatus, LifecycleRunResult } from "../api";
import { lifecycleTone, isLifecycleUp } from "../lib/dashboard-view";
```

2. Add per-section pending state next to the existing `pending` signal:

```ts
  // Per-section optimistic status, keyed by section name.
  const [sectionPending, setSectionPending] = createSignal<Record<string, LifecycleStatus>>({});
```

3. In the project-switch reset effect, also clear section pending:

```ts
  createEffect((prev: string | undefined) => {
    const id = props.projectId;
    if (prev !== undefined && prev !== id) {
      setError(null);
      setOutput(null);
      setPending(null);
      setSectionPending({});
    }
    return id;
  });
```

4. Extend the `fast()` poll gate so section transients poll fast. Replace the `fast` memo with:

```ts
  const anySectionTransient = () => {
    const secs = data()?.sections ?? [];
    const pend = sectionPending();
    return secs.some((s) => isTransient(pend[s.name] ?? s.status));
  };
  const fast = createMemo(() => busy() || isTransient(displayStatus()) || anySectionTransient());
```

5. Add a section run handler next to `run`:

```ts
  const runSection = async (name: string, kind: "start" | "stop", fn: (id: string, section: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setSectionPending((p) => ({ ...p, [name]: kind === "start" ? "starting" : "stopping" }));
    try {
      const r = await fn(props.projectId, name);
      setOutput(r.output || "(no output)");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionPending((p) => { const { [name]: _drop, ...rest } = p; return rest; });
      setBusy(false);
    }
  };
```

6. Render the section list. Inside the `<Show when={data()}>` render block, after the top-level `last run` `<details>` (still inside the returned `<>`…`</>`), add:

```tsx
              <Show when={d().sections && d().sections!.length > 0}>
                <div class="lifecycle-sections">
                  <For each={d().sections!}>
                    {(sec) => {
                      const secStatus = (): LifecycleStatus => sectionPending()[sec.name] ?? sec.status;
                      const up = () => sec.config.health ? isLifecycleUp(secStatus()) : true;
                      return (
                        <div class="lifecycle-section">
                          <span class="lifecycle-section-name">{sec.name}</span>
                          <Show when={secStatus() !== "none"}>
                            <span class={`chip chip-${lifecycleTone(secStatus())}`} title={`${sec.name} lifecycle`}>{secStatus()}</span>
                          </Show>
                          <Show when={sec.config.url && up()}>
                            <a class="lifecycle-link" href={sec.config.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
                          </Show>
                          <Show when={sec.config.start}>
                            <button class="lifecycle-btn" disabled={busy()} onclick={() => runSection(sec.name, "start", startSection)}>Start</button>
                          </Show>
                          <Show when={sec.config.stop}>
                            <button class="lifecycle-btn" disabled={busy()} onclick={() => runSection(sec.name, "stop", stopSection)}>Stop</button>
                          </Show>
                          <Show when={sec.lastRun?.output}>
                            {(out) => (
                              <details open={sec.lastRun?.failed ?? false} class="lifecycle-output">
                                <summary>last run</summary>
                                <pre>{out()}</pre>
                              </details>
                            )}
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
```

Note on `up()`: a launcher (no `health`) has no up-signal, so its Open link shows whenever it has a `url` (a plain convenience link, per the spec). A health section gates the link on `isLifecycleUp` (`healthy`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun run test -- LifecyclePanel`
Expected: PASS — all panel tests, old and new.

- [ ] **Step 5: Type-check**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/LifecyclePanel.tsx web/tests/LifecyclePanel.test.tsx
git commit -m "feat(web): render named lifecycle sections in the project panel"
```

---

## Task 7: Style the section rows

**Files:**
- Modify: the stylesheet that defines `.lifecycle-panel` (find it in Step 1)

- [ ] **Step 1: Locate the lifecycle styles**

Run: `cd web && grep -rn "lifecycle-panel\|lifecycle-btn\|lifecycle-link" src --include=*.css`
Expected: one CSS file (e.g. `src/styles.css` or similar) containing the existing lifecycle classes. Use that file below.

- [ ] **Step 2: Add section styles**

Append to that CSS file (match the existing spacing/token conventions you see there — the values below are a reasonable default that mirrors the panel's inline row layout):

```css
.lifecycle-sections {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border, #2a2a2a);
}
.lifecycle-section {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.lifecycle-section-name {
  font-weight: 600;
  font-size: 0.85em;
}
```

If the file uses different design tokens (e.g. a named border variable), substitute the one already used elsewhere in that file rather than the fallback above.

- [ ] **Step 3: Visual smoke check (optional but recommended)**

If a dev server is convenient, run the app, open a project that has a `forest.yaml` with a `sections:` map, enable lifecycle, and confirm the section rows render with name + chip + buttons. Otherwise rely on the component test from Task 6.

- [ ] **Step 4: Commit**

```bash
git add web/src/*.css
git commit -m "style(web): lifecycle section row layout"
```

---

## Task 8: Document `sections` in the forest-yaml skill

**Files:**
- Modify: `skills/forest-yaml/SKILL.md`

- [ ] **Step 1: Add a sections section**

In `skills/forest-yaml/SKILL.md`, after the "File Format" section (before "Security: the file is inert until enabled"), insert:

````markdown
## Named sections (independent start/stop/link)

A project can have several things worth starting, stopping, or linking to
independently. Add a `sections:` map — each entry takes the **same** four keys as
the top level (`start`, `stop`, `health`, `url`) and runs on its own:

```yaml
# forest.yaml
start:  godot --editor .          # top-level = the editor
stop:   pkill -f "godot --editor"

sections:
  game:
    start:  godot .
    stop:   pkill -f "godot ."
    url:    http://localhost:8060
    health: pgrep -f "godot ."     # gives this section a status chip
```

- Each section gets its own Start / Stop / Open buttons in the project panel.
- A section shows a live **status chip** (`healthy`/`stopped`) only if it has a
  `health` command — that's the only way Forest can tell a section is up, since a
  running process can't be attributed to a specific section. A section without
  `health` is a launcher: it still runs and shows its last output, just no chip.
- The single **Enable lifecycle** toggle covers the whole file, sections
  included. Emit `sections` only when a project really has separate lifecycles;
  a plain top-level `start`/`stop` is still the common case.
````

- [ ] **Step 2: Commit**

```bash
git add skills/forest-yaml/SKILL.md
git commit -m "docs(forest-yaml): document named sections"
```

---

## Task 9: Full test sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the server suite**

Run: `cd server && bun test`
Expected: PASS — all lifecycle suites green, no regressions elsewhere.

- [ ] **Step 2: Run the web suite**

Run: `cd web && bun run test`
Expected: PASS — including `LifecyclePanel` and any `dashboard-view` tests.

- [ ] **Step 3: Type-check web**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Fix any failures**

If anything fails, use superpowers:systematic-debugging before patching. Do not weaken a test to make it pass.

---

## Self-Review Notes

- **Spec coverage:** config schema (T1), status model incl. `none`/`healthy`/`stopped` (T2, T4), registry per-target keying + independent in-flight (T3), routes + live GET status + 404/400/409 guards (T4), API types (T5), panel UI incl. optimistic pending, poll cadence, Open-link rule, dashboard card untouched (T6), styles (T7), docs (T8). All spec sections map to a task.
- **Out-of-scope items** (detect patterns, card section chips, per-section enable, nested sections, section `errors` state) are intentionally not implemented.
- **Type consistency:** `computeSectionStatus`, `LifecycleSection`, `SectionView`/`LifecycleSectionView`, `startSection`/`stopSection`, and registry method signatures (`(id, …, section?)`) are used identically across tasks.
