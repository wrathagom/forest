# Multi-agent-aware Sessions overview

**Date:** 2026-07-06
**Status:** Approved (design)

## Problem

Forest already tracks a `profile` per agent session (the multi-agent-profiles
integration tags each session with the `CLAUDE_CONFIG_DIR` it came from — e.g.
`personal`, `work`, `default`). That profile flows through the DB, the API, and
renders as a small badge on session bars. But the **Sessions overview page
ignores it entirely**: the stats queries (`tokensByProject`, `tokensOverTime`)
never group by profile, and the page has no profile filter, no profile column,
and no per-profile breakdown.

Goal: make the Sessions overview multi-agent aware — let the user see
sessions / tokens broken down by account/profile (e.g. Personal vs
Professional) alongside the existing project and token-type breakdowns.

## Scope (agreed)

Four surfaces, all driven by the existing `profile` dimension:

1. A dedicated **"tokens by profile"** breakdown chart.
2. A **global profile filter** dropdown.
3. A **profile column** in the sessions table (sortable).
4. The **"tokens · last 30 days"** chart becomes splittable **by account** in
   addition to the existing by-token-type view (a mode toggle: account type
   *vs* token type).

## Profile key normalization

One shared rule, applied identically in every new/changed query and in the UI:

- `profile IS NULL` → bucket key `"unassigned"` (never-tagged sessions)
- `profile = "default"` → bucket key `"default"`
- otherwise → the raw profile string

`null` and `"default"` stay **separate** buckets (per decision). No friendly
renaming / display-name mapping — raw names are shown as-is.

## Backend

All changes in `server/src/sessions/vault.ts` and
`server/src/routes/sessions-overview.ts`.

### 1. `tokensByProfile()` — new (mirrors `tokensByProject()`)

```
SELECT <normalized profile> AS profile,
       COALESCE(SUM(m.input_tokens), 0)  AS input,
       COALESCE(SUM(m.output_tokens), 0) AS output,
       COALESCE(SUM(m.cache_create_tokens),0) + COALESCE(SUM(m.cache_read_tokens),0) AS cache,
       COUNT(DISTINCT s.session_id) AS sessions
  FROM agent_sessions s
  LEFT JOIN agent_messages m ON m.session_id = s.session_id
 GROUP BY <normalized profile>
```

Returns `Array<{ profile: string; input; output; cache; sessions }>` sorted by
`input+output+cache` descending. The normalization is done in SQL
(`CASE WHEN s.profile IS NULL THEN 'unassigned' WHEN s.profile = 'default'
THEN 'default' ELSE s.profile END`) or in JS after grouping on
`COALESCE(s.profile, '\x00null')` — implementer's choice, as long as null and
default remain distinct.

### 2. `tokensOverTime({ days })` — extended

Currently groups `agent_messages` by day into input/output/cache. Extend it to
also produce per-profile-per-day totals by joining to `agent_sessions`:

- Keep each point's existing `{ day, input, output, cache }` fields unchanged
  (by-token-type view).
- Add `byProfile: Record<string, number>` to each point — total tokens
  (`input+output+cache`) for that profile on that day, using normalized keys.
  Days/profiles with no activity are simply absent from the map (renderer treats
  missing as 0).

The stats response additionally returns `profiles: string[]` — the distinct
normalized profile keys present in the window, sorted by total tokens
descending. This drives both the by-account legend ordering and its color
assignment (stable index → palette color).

### 3. `list()` — profile filter + sort

- New optional `profile` filter param on the existing `list()` opts, wired
  through `/api/sessions?profile=`. Mirrors the `projectId` filter exactly:
  - `profile === "unassigned"` → `s.profile IS NULL`
  - otherwise → `s.profile = ?`
- Add `"profile"` to the allowed sort columns → `s.profile` (with
  `NULLS LAST`, like `project`).

### 4. Stats endpoint

`/api/sessions/stats` response gains `tokensByProfile` and `profiles`.
`tokensOverTime` points gain `byProfile`. `totals` is unchanged.

**Consistency call (agreed):** the profile filter slices **the session table
only**, not the charts or totals — identical to how the existing project filter
behaves today. The breakdown charts always show all profiles so Personal vs
Professional can be compared side by side. Clicking a bar in the "tokens by
profile" chart sets the table's profile filter (same pattern as the by-project
chart setting the project filter).

## Frontend

### `web/src/api.ts`

- `TokensByProfileRow = TokenBucket & { profile: string; sessions: number }`.
- `TokensOverTimePoint` gains `byProfile: Record<string, number>`.
- `SessionsStatsResponse` gains `tokensByProfile: TokensByProfileRow[]` and
  `profiles: string[]`.
- `SessionsSort` gains `"profile"`.
- `fetchSessionsOverview` accepts `profile?: string` and appends it to the query
  string.

### `web/src/components/charts/TokensByProfileChart.tsx` — new

A near-clone of `TokensByProjectChart.tsx`: one horizontal bar per profile with
the input/output/cache split, respecting the shared `series` legend toggles.
`onSelectProfile?(profile: string)` fires on row click. Kept as its own
component (rather than generalizing the project chart) for isolation and to
match the existing pattern.

### `web/src/components/charts/TokensOverTimeChart.tsx` — extended

- New prop `mode: "type" | "profile"`.
- New props to support profile mode: `profiles: string[]` and a color accessor
  (or the chart derives colors from `profiles` order via a shared palette
  helper).
- `mode === "type"` → unchanged (input/output/cache stacks driven by `series`).
- `mode === "profile"` → stacks each day by `point.byProfile[profileKey]`
  using categorical colors, one stack segment per profile in `profiles` order.
- Categorical palette pulled from the `dataviz` skill's guidance at
  implementation time; a small shared helper maps `profiles[]` index → color so
  the chart body and the profile legend agree.

### `web/src/pages/Sessions.tsx`

- New `profile` signal + `<select>` dropdown ("all profiles" default; options
  from `stats().profiles`), placed next to the existing project dropdown.
  Selecting a profile feeds the `page` (table) resource and resets `offset`
  (add `profile()` to the offset-reset effect).
- New **time-chart mode toggle** (`by type | by account`) on the
  "tokens · last 30 days" card. In `by account` mode, render a profile legend
  (colored swatches) instead of / in addition to the input/output/cache legend.
- New **"tokens by profile"** chart card added to the `.sessions-charts` grid,
  wired with `onSelectProfile={(p) => setProfile(p)}`.
- New **profile column** in the sessions table, showing `s.profile`
  (rendered as its normalized label; `null` shows as "unassigned"). Added to
  `COLUMNS` with `key: "profile"` so it's sortable via the existing header-click
  mechanism.

## Testing

- **`server/tests/vault.test.ts`**
  - `tokensByProfile` aggregates tokens + session counts per profile and keeps
    `null` (→ "unassigned") and `"default"` as distinct buckets.
  - `tokensOverTime` populates `byProfile` per day and the response's
    `profiles` list; days with no activity yield empty/0.
  - `list({ profile })` filters correctly for `"unassigned"` and a named
    profile; `sort: "profile"` orders as expected.
- **`web/tests/charts.test.tsx`**
  - `TokensByProfileChart` renders one row per profile with correct labels and
    fires `onSelectProfile`.
  - `TokensOverTimeChart` in `mode="profile"` renders per-profile stacks.
- **`web/tests/Sessions.test.tsx`**
  - Profile dropdown renders options from `profiles` and filters the table.
  - Profile column renders and is sortable.
  - Time-chart mode toggle switches between type and account views.

## Out of scope

- Configurable / friendly display names for profiles (settings mapping).
- Slicing the charts or totals by the profile filter.
- Any change to the mobile surface or the live-session HUD.
- Backfilling profiles onto historically untagged sessions.
