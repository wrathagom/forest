# forest.yaml Project Lifecycle — Design

**Date:** 2026-08-31
**Status:** Approved (pending spec review)

## Problem

A recurring workflow: hop into a project, ask Claude/Codex to start it, use it
for a while, leave, then ask an agent to shut it down. The start/stop knowledge
lives only in the conversation — nothing durable, nothing Forest can act on, and
no at-a-glance signal of whether a project is currently running or broken.

We want a committed, per-project `forest.yaml` that captures how to **start**,
**stop**, and **health-check** a project, and to make Forest a first-class player:
Start/Stop buttons, a health probe on the scan tick, and a new **lifecycle**
status dimension you can color dashboard cards by.

## Goals

- A simple `forest.yaml` schema an agent can author on request ("make a forest.yaml
  with start/stop/health").
- Forest can launch and stop a project from the UI.
- Forest reflects a project's lifecycle status: stopped / running / healthy /
  errors — without auto-executing shell from untrusted, freshly-cloned repos.

## Non-goals (v1, deliberately cut)

- Long-lived / supervised processes. `start` is expected to background its work
  (`docker compose up -d`, a `make start` that detaches). Forest does **not**
  hold the process alive — it survives Forest restarts because Forest isn't
  babysitting anything.
- Run history / log persistence. Last start/stop output is kept **in memory
  only**.
- Extra schema (`name`, `url`, env, multiple named services, `restart`). Room to
  grow later; not now.
- An on-demand health endpoint. Health runs on the scan tick.
- Card-menu Start/Stop. Buttons live on the project detail page for v1.

## Decisions (agreed during brainstorming)

1. **First-class feature**, not just a convention — Forest parses the file, shows
   buttons, runs health, and surfaces status.
2. **One-shot execution.** `start`/`stop` are single shell strings run via
   `sh -c`, expected to return promptly and leave work backgrounded.
3. **Status logic: services probe = up/down, health = healthy/broken.** Forest's
   existing docker/process probes decide whether anything is up; the health
   command only refines healthy vs. broken on something already up.
4. **Opt-in per project.** A `forest.yaml` is inert until the user enables
   lifecycle for that specific project. This is the security boundary: Forest
   scans arbitrary repos under the scan root, so no discovered file runs anything
   until explicitly enabled.

## The `forest.yaml` file

Lives at the **project repo root**, committed with the project. Each command is a
single shell string run through `sh -c` (so `make start`, pipes, `&&` all work),
cwd = project path.

```yaml
# forest.yaml — how Forest launches, stops, and health-checks this project
start:  docker compose up -d          # required for a Start button
stop:   docker compose down           # required for a Stop button
health: curl -fsS localhost:3000/up   # optional; exit 0 = healthy, nonzero = errors
```

- All three keys are individually optional. A button only appears when its
  command exists (no `stop` → no Stop button).
- `health` optional; without it, a running project shows "running (unknown
  health)".
- Unknown keys are ignored (forward-compat).
- This is also **the artifact you ask an agent to author.** The schema is
  documented in the README so Claude/Codex can write it reliably.

## Lifecycle status model

A new `lifecycle` field on each project's `Snapshot`, computed each scan tick,
**only for lifecycle-enabled projects**.

| Condition | Status | Card treatment |
|---|---|---|
| No `forest.yaml`, or present but not enabled | `none` | neutral, no chip (Enable affordance if a file is present) |
| Enabled, nothing detected up | `stopped` | ○ dim / neutral |
| Enabled, up, `health` exits 0 | `healthy` | ● healthy (green) |
| Enabled, up, `health` exits nonzero | `errors` | ● error (red) |
| Enabled, up, no `health` command | `running` | ● running color |
| Start command in flight | `starting` | ● transient |
| Stop command in flight | `stopping` | ● transient |
| Start command itself failed (nonzero/timeout) | `start-failed` | ● error + output |
| Stop command itself failed | `stop-failed` | ● error + output |

- **"Up"** reuses Forest's existing docker + process probes
  (`snapshot.services`). Combined with opt-in, a cloned repo's health command
  never fires unprompted: it isn't enabled, and even once enabled health only
  runs on something already up.
- Transient (`starting`/`stopping`) and `*-failed` states come from an in-memory
  registry (below) and take precedence over the scan-derived status while active;
  the next scan reconciles back to a steady state.

## Server architecture

New self-contained module `server/src/lifecycle/`, keeping the pure scanner
(`server/src/scanner/`) untouched.

- **`config.ts`** — `readConfig(path): ForestConfig | null`. Reads/parses
  `<path>/forest.yaml` (Bun's built-in YAML). Tolerant: a missing file returns
  `null`; a malformed file logs a warning and returns `null`. Shape:
  `{ start?: string; stop?: string; health?: string }`.
- **`run.ts`** — `runCommand(cmd, cwd, { timeoutMs, signal }): Promise<{ exitCode: number; output: string; timedOut: boolean }>`.
  One-shot `sh -c` spawn, merges stdout+stderr into `output`, aborts on timeout.
  Timeouts: start/stop ~120s; health reuses the short scan budget
  (`PER_PROJECT_TIMEOUT_MS`, 10s).
- **`status.ts`** — `computeLifecycle(input): LifecycleStatus` where
  `input = { enabled: boolean; hasConfig: boolean; servicesUp: boolean; health?: { exitCode: number } | null }`.
  Pure and exhaustively unit-testable — one branch per row of the status table
  (excluding the transient/registry-owned states).
- **`registry.ts`** — `LifecycleRegistry`: an in-memory `Map<projectId, { transient?: 'starting' | 'stopping'; lastRun?: { kind: 'start' | 'stop'; exitCode: number; output: string; at: number; failed: boolean } }>`.
  Set when a start/stop call is in flight; read by the scan wrapper and the
  `GET` route.

**Wiring (`server/src/index.ts`).** The `scanProject` dependency the loop already
takes is wrapped: run the normal snapshot, then, only when the project is
lifecycle-enabled **and** its config has a `health` command **and**
`servicesUp` is true, run health and fold the result into `computeLifecycle`.
The parallel probe core (`scanProject`) is unchanged; lifecycle is a **sequenced
post-step** because it needs (a) the services result and (b) vault access for the
enabled flag — neither of which belongs in the pure scanner. The wrapper also
applies any active transient/`*-failed` state from the registry.

`Snapshot` (`server/src/scanner/types.ts`) gains:

```ts
lifecycle: {
  status: LifecycleStatus;   // see table; 'none' when N/A
  hasConfig: boolean;        // forest.yaml present on disk
  enabled: boolean;
  health: { exitCode: number } | null;  // last health result this tick, if run
};
```

`emptySnapshot()` seeds `{ status: 'none', hasConfig: false, enabled: false, health: null }`.

## Storage & API

**Storage.** One new column on `projects`:
`lifecycle_enabled INTEGER NOT NULL DEFAULT 0` (migration in
`server/src/store/db.ts`, following the existing additive-migration pattern).
`Project` gains `lifecycleEnabled: boolean`; `ProjectPatch` gains
`lifecycleEnabled?: boolean` and `updateProject` handles it. No run-history
table — last-run output lives in the in-memory registry.

**Routes** (`server/src/routes/lifecycle.ts`, registered like the other route
factories):

- `GET /api/projects/:id/lifecycle` →
  `{ hasConfig, enabled, config: { start?, stop?, health? } | null, status, lastRun }`.
  `config` echoes the parsed commands so the UI can show which buttons apply.
- `POST /api/projects/:id/lifecycle/enable` `{ enabled: boolean }` → sets the
  flag; returns the updated lifecycle view.
- `POST /api/projects/:id/lifecycle/start` → sets transient `starting`, runs
  `start`, records `lastRun`, returns `{ exitCode, output }`. Triggers an
  immediate scan refresh so status reconciles quickly.
- `POST /api/projects/:id/lifecycle/stop` → same for `stop`.

Guards: start/stop return **400** when the project isn't enabled or the relevant
command is absent; **404** for an unknown project id (matching existing route
conventions). Concurrent start/stop for the same project is rejected while a
transient is active (409 / no-op).

## Web UI

- **Project detail page** — a new **Lifecycle** panel:
  - Status chip (reusing the shared status-color helper).
  - **Start** / **Stop** buttons — each shown only when its command exists,
    disabled while a run is in flight (transient state).
  - Collapsible **last-run output** (from `lastRun`), auto-expanded on a
    `*-failed` result.
  - When `hasConfig && !enabled`: an **Enable lifecycle** action (single
    confirm — this is the opt-in gate).
  - When `!hasConfig`: a one-line hint on adding a `forest.yaml` (with the
    schema), so the feature is discoverable and points the user at asking an
    agent to author one.
- **Dashboard cards** — add `lifecycle` to the existing **color-by** dropdown
  (`web/src/components/DashboardToolbar.tsx`, with the dimension type in
  `web/src/lib/preferences.ts`) with a legend entry, and render a lifecycle chip
  in the `status`/`detail` card presets (`web/src/components/ProjectCard.tsx`).
  Reuses the established role colors
  (healthy = green, errors = red, stopped = neutral) shared with the git /
  services / agents dimensions, so contrast handling is already covered by the
  existing per-theme band/chip machinery.

## Testing

Following the repo's probe/route-unit + integration pattern:

- **`status.test.ts`** — `computeLifecycle` for every non-transient row of the
  table (none/stopped/running/healthy/errors across enabled + servicesUp +
  health permutations).
- **`config.test.ts`** — `readConfig`: valid file, missing file (`null`),
  malformed YAML (`null` + warning), partial (only `start`).
- **`run.test.ts`** — `runCommand`: exit-0 output capture, nonzero exit code,
  timeout → `timedOut: true`, cwd correctness.
- **`routes-lifecycle.test.ts`** — enable toggle; start/stop happy path; 400 when
  not enabled; 400 when command absent; 404 unknown id; transient/409 while in
  flight.
- **Wiring test** — an enabled project with a passing health command lands
  `lifecycle.status === 'healthy'`; a failing one lands `'errors'`; an enabled
  project with nothing up lands `'stopped'`; a not-enabled project with a
  `forest.yaml` stays `'none'` (and never runs health).

## Documentation

- README: a **Project lifecycle (`forest.yaml`)** section with the schema, the
  opt-in step, and the status semantics — written so it doubles as the reference
  an agent uses to author the file.

## Rollout / migration

- Additive DB column with a default of `0`, so existing projects are simply
  "not enabled" until the user opts in. No data backfill.
- No change to any existing probe or snapshot consumer beyond the additive
  `lifecycle` field (seeded on `emptySnapshot`), so older snapshots and all
  current color-by dimensions keep working.
