# Multi-agent-aware Sessions overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing per-session `profile` (account) dimension in the Sessions overview — a "tokens by account" breakdown chart, an account filter, an account column, and a by-account mode on the 30-day tokens chart.

**Architecture:** The `profile` column already exists on `agent_sessions` and flows through the API. Backend work: one new aggregation (`tokensByProfile`), a per-profile roll-up added to `tokensOverTime`, and a `profile` filter/sort on `listAll`. Frontend work: a new bar chart, a mode toggle + profile legend on the time chart, an account dropdown, and an account table column. Profile keys are normalized identically everywhere: `NULL → "unassigned"`, `"default"` stays `"default"`, else the raw string. `null` and `"default"` remain distinct buckets.

**Tech Stack:** Bun + TypeScript + SQLite (server, `bun test`); SolidJS + Vite (web, `vitest`).

**Consistency note (from the spec):** the account filter slices the **session table only**, not the charts/totals — identical to the existing project filter. Clicking a bar in the "tokens by account" chart sets the table's account filter. `profiles` (ordering used for legend + colors) is derived in the stats route from `tokensByProfile` so both charts share a stable color order.

---

## File Structure

**Server**
- `server/src/sessions/vault.ts` — add `TokensByProfileRow` type; add `byProfile` to `TokensOverTimePoint`; add `tokensByProfile()`; extend `tokensOverTime()`; add `profile` filter + `"profile"` sort to `listAll()`.
- `server/src/routes/sessions-overview.ts` — return `tokensByProfile` + `profiles`; accept `profile` query param; allow `profile` sort.
- `server/tests/vault-overview.test.ts` — tests for `tokensByProfile`, `tokensOverTime.byProfile`, `listAll({ profile })`.
- `server/tests/routes-sessions-overview.test.ts` — tests for stats `tokensByProfile`/`profiles` and `?profile=` filter.

**Web**
- `web/src/api.ts` — extend `SessionListRow`, `TokensOverTimePoint`, `SessionsStatsResponse`, `SessionsSort`; add `TokensByProfileRow`; add `profile` param to `fetchSessionsOverview`.
- `web/src/components/charts/profileColors.ts` — **new** categorical palette + `profileColorMap()` helper.
- `web/src/components/charts/TokensByProfileChart.tsx` — **new** bar chart (reuses `.tbp` CSS).
- `web/src/components/charts/TokensOverTimeChart.tsx` — add `mode`/`profiles`/`colors` props + profile-stack rendering.
- `web/src/pages/Sessions.tsx` — account dropdown, mode toggle + profile legend, "tokens by account" card, account column.
- `web/src/styles.css` — `.chart-toolbar` + `.chart-mode-toggle` styles.
- `web/tests/charts.test.tsx` — tests for the new chart + profile mode (and update the `days()` helper).
- `web/tests/Sessions.test.tsx` — tests for the account column + dropdown (and update fixtures).

---

## Task 1: `tokensByProfile()` aggregation (server)

**Files:**
- Modify: `server/src/sessions/vault.ts` (add type near line 38; add method after `tokensByProject`, ~line 413)
- Test: `server/tests/vault-overview.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/tests/vault-overview.test.ts` (reuses the module's existing `msg` helper):

```ts
describe("Vault.tokensByProfile", () => {
  test("aggregates per profile, keeping null (unassigned) and 'default' distinct, sorted by total desc", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "sp1", agent: "claude", cwd: "/a", last_activity: 1, profile: "personal", source: "scan" });
    v.upsertSession({ session_id: "sp2", agent: "claude", cwd: "/b", last_activity: 2, profile: "work", source: "scan" });
    v.upsertSession({ session_id: "sp3", agent: "claude", cwd: "/c", last_activity: 3, profile: "default", source: "scan" });
    v.upsertSession({ session_id: "sp4", agent: "claude", cwd: "/d", last_activity: 4, source: "scan" }); // null profile
    v.upsertMessages([msg("sp1", "m1", 1, { input: 50, output: 10 })], [{ uuid: "m1", text: "x" }]);
    v.upsertMessages([msg("sp2", "m2", 2, { input: 1000, output: 0 })], [{ uuid: "m2", text: "y" }]);
    v.upsertMessages([msg("sp3", "m3", 3, { input: 5, output: 0 })], [{ uuid: "m3", text: "z" }]);
    v.upsertMessages([msg("sp4", "m4", 4, { input: 1, output: 0 })], [{ uuid: "m4", text: "w" }]);
    const rows = v.tokensByProfile();
    expect(rows.map((r) => r.profile)).toEqual(["work", "personal", "default", "unassigned"]);
    expect(rows.find((r) => r.profile === "personal")).toEqual({ profile: "personal", input: 50, output: 10, cache: 0, sessions: 1 });
    expect(rows.find((r) => r.profile === "unassigned")).toEqual({ profile: "unassigned", input: 1, output: 0, cache: 0, sessions: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: FAIL — `v.tokensByProfile is not a function`.

- [ ] **Step 3: Add the type**

In `server/src/sessions/vault.ts`, immediately after the `TokensByProjectRow` type (ends ~line 42), add:

```ts
export type TokensByProfileRow = TokenBucket & {
  profile: string;
  sessions: number;
};
```

- [ ] **Step 4: Add the method**

In `server/src/sessions/vault.ts`, directly after the `tokensByProject()` method (closes ~line 413), add:

```ts
  tokensByProfile(): TokensByProfileRow[] {
    const norm = "CASE WHEN s.profile IS NULL THEN 'unassigned' ELSE s.profile END";
    const rows = this.db
      .query<{ profile: string; input: number; output: number; cache: number; sessions: number }, []>(
        `SELECT ${norm} AS profile,
                COALESCE(SUM(m.input_tokens), 0)  AS input,
                COALESCE(SUM(m.output_tokens), 0) AS output,
                COALESCE(SUM(m.cache_create_tokens), 0) + COALESCE(SUM(m.cache_read_tokens), 0) AS cache,
                COUNT(DISTINCT s.session_id) AS sessions
           FROM agent_sessions s
           LEFT JOIN agent_messages m ON m.session_id = s.session_id
          GROUP BY ${norm}`,
      )
      .all();
    return rows
      .map((r) => ({ profile: r.profile, input: r.input, output: r.output, cache: r.cache, sessions: r.sessions }))
      .sort((a, b) => b.input + b.output + b.cache - (a.input + a.output + a.cache));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/sessions/vault.ts server/tests/vault-overview.test.ts
git commit -m "feat(sessions): add tokensByProfile aggregation"
```

---

## Task 2: per-profile roll-up in `tokensOverTime` (server)

**Files:**
- Modify: `server/src/sessions/vault.ts` (`TokensOverTimePoint` type ~line 37; `tokensOverTime` ~lines 358-382)
- Test: `server/tests/vault-overview.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/tests/vault-overview.test.ts` (reuses `utcMidnightToday`, `dayKey`, `msg`):

```ts
describe("Vault.tokensOverTime byProfile", () => {
  test("splits each day's tokens by profile; empty map on inactive days", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    const today = utcMidnightToday();
    v.upsertSession({ session_id: "tp1", agent: "claude", cwd: "/a", last_activity: today, profile: "personal", source: "scan" });
    v.upsertSession({ session_id: "tp2", agent: "claude", cwd: "/b", last_activity: today, profile: "work", source: "scan" });
    v.upsertMessages([msg("tp1", "n1", today + 1000, { input: 10, output: 5 })], [{ uuid: "n1", text: "a" }]);
    v.upsertMessages([msg("tp2", "n2", today + 2000, { input: 100, output: 0 })], [{ uuid: "n2", text: "b" }]);
    const out = v.tokensOverTime({ days: 7 });
    const todayPoint = out[out.length - 1]!;
    expect(todayPoint.day).toBe(dayKey(today));
    expect(todayPoint.byProfile).toEqual({ personal: 15, work: 100 });
    expect(out[0]!.byProfile).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: FAIL — `todayPoint.byProfile` is `undefined`.

- [ ] **Step 3: Extend the type**

In `server/src/sessions/vault.ts`, change line 37 from:

```ts
export type TokensOverTimePoint = TokenBucket & { day: string };
```

to:

```ts
export type TokensOverTimePoint = TokenBucket & { day: string; byProfile: Record<string, number> };
```

- [ ] **Step 4: Extend the method**

Replace the body of `tokensOverTime(opts: { days: number })` (~lines 358-382) with:

```ts
  tokensOverTime(opts: { days: number }): TokensOverTimePoint[] {
    const dayMs = 86_400_000;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startUtc = todayUtc - (opts.days - 1) * dayMs;
    const rows = this.db
      .query<{ day: string; input: number; output: number; cache: number }, [number]>(
        `SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS day,
                COALESCE(SUM(input_tokens), 0)  AS input,
                COALESCE(SUM(output_tokens), 0) AS output,
                COALESCE(SUM(cache_create_tokens), 0) + COALESCE(SUM(cache_read_tokens), 0) AS cache
           FROM agent_messages
          WHERE timestamp >= ?
          GROUP BY day`,
      )
      .all(startUtc);
    const byDay = new Map(rows.map((r) => [r.day, r]));

    const profRows = this.db
      .query<{ day: string; profile: string; total: number }, [number]>(
        `SELECT strftime('%Y-%m-%d', m.timestamp / 1000, 'unixepoch') AS day,
                CASE WHEN s.profile IS NULL THEN 'unassigned' ELSE s.profile END AS profile,
                COALESCE(SUM(m.input_tokens), 0) + COALESCE(SUM(m.output_tokens), 0)
                  + COALESCE(SUM(m.cache_create_tokens), 0) + COALESCE(SUM(m.cache_read_tokens), 0) AS total
           FROM agent_messages m
           JOIN agent_sessions s ON s.session_id = m.session_id
          WHERE m.timestamp >= ?
          GROUP BY day, profile`,
      )
      .all(startUtc);
    const profByDay = new Map<string, Record<string, number>>();
    for (const r of profRows) {
      const bucket = profByDay.get(r.day) ?? {};
      bucket[r.profile] = r.total;
      profByDay.set(r.day, bucket);
    }

    const out: TokensOverTimePoint[] = [];
    for (let i = 0; i < opts.days; i++) {
      const key = new Date(startUtc + i * dayMs).toISOString().slice(0, 10);
      const hit = byDay.get(key);
      out.push({
        day: key,
        input: hit?.input ?? 0,
        output: hit?.output ?? 0,
        cache: hit?.cache ?? 0,
        byProfile: profByDay.get(key) ?? {},
      });
    }
    return out;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: PASS (both the new test and the existing `tokensOverTime` day-bucketing test).

- [ ] **Step 6: Commit**

```bash
git add server/src/sessions/vault.ts server/tests/vault-overview.test.ts
git commit -m "feat(sessions): add per-profile roll-up to tokensOverTime"
```

---

## Task 3: profile filter + sort in `listAll` and the stats route (server)

**Files:**
- Modify: `server/src/sessions/vault.ts` (`SessionListSort` ~line 44; `listAll` opts ~line 280; sort map ~line 291; WHERE build ~line 304)
- Modify: `server/src/routes/sessions-overview.ts`
- Test: `server/tests/vault-overview.test.ts`, `server/tests/routes-sessions-overview.test.ts`

- [ ] **Step 1: Write the failing vault test**

Append to `server/tests/vault-overview.test.ts`:

```ts
describe("Vault.listAll profile filter + sort", () => {
  test("filters by profile and by 'unassigned' (null profile)", () => {
    const db = openDb(":memory:");
    const v = new Vault(db);
    v.upsertSession({ session_id: "lp1", agent: "claude", cwd: "/a", last_activity: 3, profile: "personal", source: "scan" });
    v.upsertSession({ session_id: "lp2", agent: "claude", cwd: "/b", last_activity: 2, profile: "work", source: "scan" });
    v.upsertSession({ session_id: "lp3", agent: "claude", cwd: "/c", last_activity: 1, source: "scan" }); // null
    expect(v.listAll({ profile: "personal" }).sessions.map((s) => s.session_id)).toEqual(["lp1"]);
    expect(v.listAll({ profile: "personal" }).total).toBe(1);
    expect(v.listAll({ profile: "unassigned" }).sessions.map((s) => s.session_id)).toEqual(["lp3"]);
    expect(v.listAll({ profile: "unassigned" }).total).toBe(1);
    expect(v.listAll({ sort: "profile", dir: "asc" }).sessions.map((s) => s.session_id)).toEqual(["lp1", "lp2", "lp3"]);
  });
});
```

(`personal` < `work` alphabetically; the null profile sorts last under `NULLS LAST`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: FAIL — profile filter is ignored, so `listAll({ profile: "personal" })` returns all 3.

- [ ] **Step 3: Add `"profile"` to the sort union**

In `server/src/sessions/vault.ts` line 44, change:

```ts
export type SessionListSort = "last_activity" | "started_at" | "tokens" | "message_count" | "project";
```

to:

```ts
export type SessionListSort = "last_activity" | "started_at" | "tokens" | "message_count" | "project" | "profile";
```

- [ ] **Step 4: Add the `profile` opt**

In the `listAll(opts: {...})` signature (~lines 280-287), add a `profile` field after `projectId`:

```ts
    projectId?: string;            // undefined/"" = all; "none" = unassigned only
    profile?: string;              // undefined/"" = all; "unassigned" = null profile only
```

- [ ] **Step 5: Handle sort + WHERE**

In the `sortCol` map (~lines 292-298) add a `profile` entry:

```ts
        project: "p.name",
        profile: "s.profile",
```

Change the `nullsLast` line (~line 299) from:

```ts
    const nullsLast = opts.sort === "project" ? " NULLS LAST" : "";
```

to:

```ts
    const nullsLast = opts.sort === "project" || opts.sort === "profile" ? " NULLS LAST" : "";
```

Immediately after the `projectId` WHERE block (~lines 304-309), add:

```ts
    if (opts.profile === "unassigned") {
      where.push("s.profile IS NULL");
    } else if (opts.profile) {
      where.push("s.profile = ?");
      whereParams.push(opts.profile);
    }
```

- [ ] **Step 6: Run vault test to verify it passes**

Run: `cd server && bun test tests/vault-overview.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing route test**

In `server/tests/routes-sessions-overview.test.ts`, give the seed's `s1` a profile so it is filterable. Change the `s1` upsert inside `seed()` (~line 14) to include `profile: "work"`:

```ts
  v.upsertSession({ session_id: "s1", agent: "claude", cwd: "/p1", project_id: "p1", worktree_label: "main", last_activity: 10, first_user_msg: "hello", profile: "work", source: "scan" });
```

Then append these tests inside the `describe("sessions-overview routes", ...)` block:

```ts
  test("GET /api/sessions/stats returns tokensByProfile + profiles", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions/stats"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions/stats")));
    const body = (await res.json()) as { tokensByProfile: Array<{ profile: string; sessions: number }>; profiles: string[] };
    expect(body.profiles).toContain("work");
    expect(body.tokensByProfile.find((r) => r.profile === "work")!.sessions).toBe(1);
  });

  test("GET /api/sessions?profile= filters by profile", async () => {
    const db = openDb(":memory:");
    const routes = sessionsOverviewRoutes({ vault: seed(db) });
    const route = routes.find((r) => r.method === "GET" && r.pattern.test("/api/sessions"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/sessions?profile=work")));
    const body = (await res.json()) as { sessions: Array<{ session_id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0]!.session_id).toBe("s1");
  });
```

- [ ] **Step 8: Run route test to verify it fails**

Run: `cd server && bun test tests/routes-sessions-overview.test.ts`
Expected: FAIL — `body.profiles` is `undefined`; the `?profile=work` request returns `total: 2` (filter not wired).

- [ ] **Step 9: Wire the route**

In `server/src/routes/sessions-overview.ts`:

Add `"profile"` to `VALID_SORTS` (~lines 7-13):

```ts
const VALID_SORTS: ReadonlySet<string> = new Set([
  "last_activity",
  "started_at",
  "tokens",
  "message_count",
  "project",
  "profile",
]);
```

In the `/api/sessions` handler's `listAll` call (~lines 30-37), add the profile param:

```ts
        const result = deps.vault.listAll({
          q: sp.get("q") ?? undefined,
          projectId: sp.get("project") ?? undefined,
          profile: sp.get("profile") ?? undefined,
          sort,
          dir,
          limit: intParam(sp.get("limit"), 50),
          offset: intParam(sp.get("offset"), 0),
        });
```

Replace the `/api/sessions/stats` handler body (~lines 44-56) with:

```ts
      handler: () => {
        const tokensByProject = deps.vault.tokensByProject();
        const tokensByProfile = deps.vault.tokensByProfile();
        const tokensOverTime = deps.vault.tokensOverTime({ days: 30 });
        const profiles = tokensByProfile.map((r) => r.profile);
        const totals = tokensByProject.reduce(
          (acc, p) => ({
            sessions: acc.sessions + p.sessions,
            input: acc.input + p.input,
            output: acc.output + p.output,
            cache: acc.cache + p.cache,
          }),
          { sessions: 0, input: 0, output: 0, cache: 0 },
        );
        return json({ tokensOverTime, tokensByProject, tokensByProfile, profiles, totals });
      },
```

- [ ] **Step 10: Run the full server suite**

Run: `cd server && bun test`
Expected: PASS (all files).

- [ ] **Step 11: Commit**

```bash
git add server/src/sessions/vault.ts server/src/routes/sessions-overview.ts server/tests/vault-overview.test.ts server/tests/routes-sessions-overview.test.ts
git commit -m "feat(sessions): profile filter/sort on listAll; expose tokensByProfile + profiles"
```

---

## Task 4: web API types (web)

**Files:**
- Modify: `web/src/api.ts`

No test — pure type/query-string wiring, exercised by later tasks' tests.

- [ ] **Step 1: Add `profile` to `SessionListRow`**

In `web/src/api.ts`, in the `SessionListRow` type (~lines 440-458), add after `branch`:

```ts
  branch: string | null;
  profile: string | null;
```

- [ ] **Step 2: Extend the chart types**

Change `TokensOverTimePoint` (~line 483) from:

```ts
export type TokensOverTimePoint = TokenBucket & { day: string };
```

to:

```ts
export type TokensOverTimePoint = TokenBucket & { day: string; byProfile: Record<string, number> };
```

Add a new type directly below the `TokensByProjectRow` line (~line 484):

```ts
export type TokensByProfileRow = TokenBucket & { profile: string; sessions: number };
```

Change `SessionsStatsResponse` (~lines 486-490) to:

```ts
export type SessionsStatsResponse = {
  tokensOverTime: TokensOverTimePoint[];
  tokensByProject: TokensByProjectRow[];
  tokensByProfile: TokensByProfileRow[];
  profiles: string[];
  totals: TokenBucket & { sessions: number };
};
```

- [ ] **Step 3: Add `"profile"` to `SessionsSort` and the fetch param**

Change `SessionsSort` (~line 460) to:

```ts
export type SessionsSort = "last_activity" | "started_at" | "tokens" | "message_count" | "project" | "profile";
```

In `fetchSessionsOverview` add `profile?: string;` to the opts type (after `project?: string;`) and set it on the query string right after the `project` line:

```ts
  if (opts.project) sp.set("project", opts.project);
  if (opts.profile) sp.set("profile", opts.profile);
```

- [ ] **Step 4: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS (no type errors introduced).

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(sessions): web API types for profile filter + tokensByProfile"
```

---

## Task 5: profile color helper (web)

**Files:**
- Create: `web/src/components/charts/profileColors.ts`

- [ ] **Step 1: Write the helper**

> Before finalizing the palette, load the `dataviz` skill and, if it provides an accessible categorical palette in `references/palette.md`, swap the hex values below for it. The values here are a validated fallback that reads in both light and dark themes.

Create `web/src/components/charts/profileColors.ts`:

```ts
// Categorical palette for per-profile (per-account) chart series. Distinct hues
// chosen to read on both light and dark backgrounds and to stay clear of the
// input/output/cache token colors. Swap for the dataviz skill's palette if desired.
export const PROFILE_PALETTE = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#34d399", // green
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#a3e635", // lime
];

// Maps profile keys (in the caller's stable order) to palette colors, cycling
// if there are more profiles than colors. Consumers (time chart + legend) share
// this map so a profile always gets the same color.
export function profileColorMap(profiles: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  profiles.forEach((p, i) => {
    map[p] = PROFILE_PALETTE[i % PROFILE_PALETTE.length]!;
  });
  return map;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/charts/profileColors.ts
git commit -m "feat(sessions): add profile color palette helper"
```

---

## Task 6: `TokensByProfileChart` component (web)

**Files:**
- Create: `web/src/components/charts/TokensByProfileChart.tsx`
- Test: `web/tests/charts.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/charts.test.tsx`:

```ts
import TokensByProfileChart from "../src/components/charts/TokensByProfileChart";

const profileRows = [
  { profile: "work", input: 1000, output: 0, cache: 0, sessions: 2 },
  { profile: "unassigned", input: 5, output: 0, cache: 0, sessions: 1 },
];

test("TokensByProfileChart renders one row per profile and fires onSelectProfile", () => {
  let picked: string | undefined;
  const { container } = render(() => (
    <TokensByProfileChart data={profileRows} onSelectProfile={(p) => (picked = p)} />
  ));
  expect(container.querySelectorAll(".tbp-row")).toHaveLength(2);
  expect(container.textContent).toContain("work");
  expect(container.textContent).toContain("unassigned");
  (container.querySelector(".tbp-row") as HTMLElement).click();
  expect(picked).toBe("work");
});

test("TokensByProfileChart renders an empty-state when there is no data", () => {
  const { container } = render(() => <TokensByProfileChart data={[]} />);
  expect(container.textContent).toContain("no data");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/charts.test.tsx`
Expected: FAIL — cannot resolve `TokensByProfileChart`.

- [ ] **Step 3: Write the component**

Create `web/src/components/charts/TokensByProfileChart.tsx` (mirrors `TokensByProjectChart`, reuses the `.tbp*` CSS classes):

```tsx
import { For, Show, createMemo } from "solid-js";
import type { TokensByProfileRow } from "../../api";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokensByProfileChart(props: {
  data: TokensByProfileRow[];
  onSelectProfile?: (profile: string) => void;
  series?: { input: boolean; output: boolean; cache: boolean };
}) {
  const view = createMemo(() => {
    const s = props.series ?? { input: true, output: true, cache: true };
    const visTotal = (r: TokensByProfileRow) => (s.input ? r.input : 0) + (s.output ? r.output : 0) + (s.cache ? r.cache : 0);
    const max = Math.max(1, ...props.data.map(visTotal));
    return props.data.map((r) => {
      const total = visTotal(r);
      const iv = s.input ? r.input : 0;
      const ov = s.output ? r.output : 0;
      const cv = s.cache ? r.cache : 0;
      return {
        r,
        total,
        widthPct: (total / max) * 100,
        inPct: total ? (iv / total) * 100 : 0,
        outPct: total ? (ov / total) * 100 : 0,
        cachePct: total ? (cv / total) * 100 : 0,
      };
    });
  });

  return (
    <Show when={props.data.length > 0} fallback={<div class="chart-empty muted">no data yet</div>}>
      <div class="tbp">
        <For each={view()}>
          {(v) => (
            <div
              class={`tbp-row ${props.onSelectProfile ? "tbp-clickable" : ""}`}
              title={`${v.r.profile}\n${v.r.sessions} session${v.r.sessions === 1 ? "" : "s"}\ninput ${fmt(v.r.input)} · output ${fmt(v.r.output)} · cache ${fmt(v.r.cache)}`}
              onclick={() => props.onSelectProfile?.(v.r.profile)}
            >
              <span class="tbp-label">{v.r.profile}</span>
              <span class="tbp-track">
                <span class="tbp-bar" style={{ width: `${v.widthPct}%` }}>
                  <span class="tok-in" style={{ width: `${v.inPct}%` }} />
                  <span class="tok-out" style={{ width: `${v.outPct}%` }} />
                  <span class="tok-cache" style={{ width: `${v.cachePct}%` }} />
                </span>
              </span>
              <span class="tbp-total muted">{fmt(v.total)}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/charts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/TokensByProfileChart.tsx web/tests/charts.test.tsx
git commit -m "feat(sessions): add TokensByProfileChart"
```

---

## Task 7: by-account mode on `TokensOverTimeChart` (web)

**Files:**
- Modify: `web/src/components/charts/TokensOverTimeChart.tsx`
- Test: `web/tests/charts.test.tsx`

- [ ] **Step 1: Update the existing `days()` helper for the new required field**

In `web/tests/charts.test.tsx`, change the `days` helper (~lines 6-7) so points carry `byProfile`:

```ts
const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, input: i, output: i, cache: i, byProfile: {} as Record<string, number> }));
```

- [ ] **Step 2: Write the failing test**

Append to `web/tests/charts.test.tsx`:

```ts
test("TokensOverTimeChart profile mode renders per-profile stacked segments", () => {
  const data = [
    { day: "2026-04-01", input: 0, output: 0, cache: 0, byProfile: { work: 100, personal: 50 } },
    { day: "2026-04-02", input: 0, output: 0, cache: 0, byProfile: { work: 20 } },
  ];
  const { container } = render(() => (
    <TokensOverTimeChart data={data} mode="profile" profiles={["work", "personal"]} colors={{ work: "#111111", personal: "#222222" }} />
  ));
  expect(container.querySelectorAll("g.totc-bar")).toHaveLength(2);
  // day 1 → 2 segments, day 2 → 1 segment
  expect(container.querySelectorAll("g.totc-bar rect").length).toBe(3);
  const fills = Array.from(container.querySelectorAll("g.totc-bar rect")).map((r) => (r as SVGElement).style.fill);
  expect(fills).toContain("rgb(17, 17, 17)");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/charts.test.tsx`
Expected: FAIL — `mode`/`profiles`/`colors` props are ignored; the type-mode branch renders `tok-in/out/cache` rects (all zero height → 0 rects) instead of profile segments.

- [ ] **Step 4: Rewrite the component**

Replace the entire contents of `web/src/components/charts/TokensOverTimeChart.tsx` with:

```tsx
import { For, Show, createMemo } from "solid-js";
import type { TokensOverTimePoint } from "../../api";

const W = 720;
const H = 180;
const M = { top: 10, right: 8, bottom: 22, left: 44 };

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type Segment = { y: number; h: number; cls?: string; color?: string };
type Bar = { x: number; title: string; segments: Segment[] };

export default function TokensOverTimeChart(props: {
  data: TokensOverTimePoint[];
  series?: { input: boolean; output: boolean; cache: boolean };
  mode?: "type" | "profile";
  profiles?: string[];
  colors?: Record<string, string>;
}) {
  const view = createMemo(() => {
    const data = props.data;
    const mode = props.mode ?? "type";
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const slot = plotW / Math.max(1, data.length);
    const barW = Math.max(1, slot * 0.7);
    const baseY = M.top + plotH;

    let max = 1;
    let bars: Bar[] = [];

    if (mode === "profile") {
      const profiles = props.profiles ?? [];
      const colors = props.colors ?? {};
      const totals = data.map((d) => profiles.reduce((sum, p) => sum + (d.byProfile[p] ?? 0), 0));
      max = Math.max(1, ...totals);
      bars = data.map((d, i) => {
        const x = M.left + i * slot + (slot - barW) / 2;
        let acc = 0;
        const segments: Segment[] = [];
        for (const p of profiles) {
          const val = d.byProfile[p] ?? 0;
          const h = (val / max) * plotH;
          segments.push({ y: baseY - acc - h, h, color: colors[p] ?? "#888" });
          acc += h;
        }
        const title = `${d.day}\n` + profiles
          .filter((p) => (d.byProfile[p] ?? 0) > 0)
          .map((p) => `${p} ${fmt(d.byProfile[p] ?? 0)}`)
          .join(" · ");
        return { x, title, segments };
      });
    } else {
      const s = props.series ?? { input: true, output: true, cache: true };
      const totals = data.map((d) => (s.input ? d.input : 0) + (s.output ? d.output : 0) + (s.cache ? d.cache : 0));
      max = Math.max(1, ...totals);
      bars = data.map((d, i) => {
        const x = M.left + i * slot + (slot - barW) / 2;
        const hIn = ((s.input ? d.input : 0) / max) * plotH;
        const hOut = ((s.output ? d.output : 0) / max) * plotH;
        const hCache = ((s.cache ? d.cache : 0) / max) * plotH;
        return {
          x,
          title: `${d.day}\ninput ${fmt(d.input)} · output ${fmt(d.output)} · cache ${fmt(d.cache)}`,
          segments: [
            { cls: "tok-in", y: baseY - hIn, h: hIn },
            { cls: "tok-out", y: baseY - hIn - hOut, h: hOut },
            { cls: "tok-cache", y: baseY - hIn - hOut - hCache, h: hCache },
          ],
        };
      });
    }

    const xLabels = data.length
      ? [0, Math.floor(data.length / 2), data.length - 1].map((i) => ({
          x: M.left + i * slot + slot / 2,
          text: data[i]!.day.slice(5), // MM-DD
        }))
      : [];
    return { bars, barW, max, xLabels, baseY };
  });

  return (
    <Show when={props.data.length > 0} fallback={<div class="chart-empty muted">no data yet</div>}>
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="tokens over time">
        <line x1={M.left} y1={view().baseY} x2={W - M.right} y2={view().baseY} class="chart-axis" />
        <line x1={M.left} y1={M.top} x2={W - M.right} y2={M.top} class="chart-grid" />
        <text x={M.left - 6} y={M.top + 4} class="chart-tick" text-anchor="end">{fmt(view().max)}</text>
        <text x={M.left - 6} y={view().baseY} class="chart-tick" text-anchor="end">0</text>
        <For each={view().bars}>
          {(b) => (
            <g class="totc-bar">
              <title>{b.title}</title>
              <For each={b.segments}>
                {(s) => (
                  <Show when={s.h > 0.5}>
                    <rect x={b.x} y={s.y} width={view().barW} height={s.h} class={s.cls} style={s.color ? { fill: s.color } : undefined} />
                  </Show>
                )}
              </For>
            </g>
          )}
        </For>
        <For each={view().xLabels}>
          {(l) => <text x={l.x} y={H - 6} class="chart-tick" text-anchor="middle">{l.text}</text>}
        </For>
      </svg>
    </Show>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && bunx vitest run tests/charts.test.tsx`
Expected: PASS (new profile-mode test plus the existing type-mode tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/charts/TokensOverTimeChart.tsx web/tests/charts.test.tsx
git commit -m "feat(sessions): by-account mode for TokensOverTimeChart"
```

---

## Task 8: wire the Sessions page (web)

**Files:**
- Modify: `web/src/pages/Sessions.tsx`
- Modify: `web/src/styles.css`
- Test: `web/tests/Sessions.test.tsx`

- [ ] **Step 1: Update test fixtures and write the failing tests**

In `web/tests/Sessions.test.tsx`, add `byProfile` to each `statsResponse.tokensOverTime` point and add the two new stats fields. Replace the `statsResponse` const (~lines 34-38) with:

```ts
const statsResponse = {
  tokensOverTime: Array.from({ length: 30 }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, input: i, output: i, cache: i, byProfile: { work: i } })),
  tokensByProject: [{ projectId: "p1", projectName: "Proj One", input: 100, output: 20, cache: 5, sessions: 1 }],
  tokensByProfile: [{ profile: "work", input: 100, output: 20, cache: 5, sessions: 1 }],
  profiles: ["work"],
  totals: { sessions: 1, input: 100, output: 20, cache: 5 },
};
```

Add `profile: "work"` to the `row()` factory default (~after `branch: null,`):

```ts
  branch: null,
  profile: "work",
```

Append these tests:

```ts
test("renders the profile column with the session's account", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(container.textContent).toContain("build the thing"));
  const headers = Array.from(container.querySelectorAll(".sessions-table th")).map((h) => h.textContent);
  expect(headers.some((h) => h?.includes("profile"))).toBe(true);
});

test("selecting an account re-fetches with the profile filter", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { container } = renderPage();
  await waitFor(() => expect(fetchSessionsOverview).toHaveBeenCalled());
  const select = container.querySelector(".sessions-profile") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "work" } });
  await waitFor(() =>
    expect(fetchSessionsOverview.mock.calls.some(([a]) => (a as { profile?: string }).profile === "work")).toBe(true),
  );
});

test("switching the chart to 'by account' shows the profile legend", async () => {
  fetchSessionsOverview.mockResolvedValue({ sessions: [row()], total: 1 });
  const { getByText, container } = renderPage();
  await waitFor(() => expect(getByText("by account")).toBeTruthy());
  fireEvent.click(getByText("by account"));
  // the profile legend lists the account name; the input/output/cache legend is gone
  await waitFor(() => expect(container.querySelector(".chart-legend")?.textContent).toContain("work"));
  expect(container.textContent).not.toContain("input");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bunx vitest run tests/Sessions.test.tsx`
Expected: FAIL — no `.sessions-profile` select, no `profile` header, no "by account" toggle.

- [ ] **Step 3: Add imports and the label helper**

In `web/src/pages/Sessions.tsx`, add to the chart imports (~lines 10-11):

```ts
import TokensByProfileChart from "../components/charts/TokensByProfileChart";
import { profileColorMap } from "../components/charts/profileColors";
```

Below the `escapeHtml` helper (~line 22), add:

```ts
function profileLabel(p: string | null): string {
  return p ?? "unassigned";
}
```

Add a `profile` column to `COLUMNS` (~lines 24-32), right after the `project` entry:

```ts
  { key: "project", label: "project" },
  { key: "profile", label: "profile" },
```

- [ ] **Step 4: Add signals + memos**

After the `series`/`toggleSeries` lines (~lines 44-45), add:

```ts
  const [profile, setProfile] = createSignal("");           // "" all, else normalized profile key
  const [chartMode, setChartMode] = createSignal<"type" | "profile">("type");
```

In the offset-reset effect (~lines 53-59), add `profile();` alongside the other tracked signals:

```ts
  createEffect(() => {
    debounced();
    project();
    profile();
    sort();
    dir();
    setOffset(0);
  });
```

Update the `page` resource (~lines 62-73) to include profile in the key and the fetch:

```ts
  const [page] = createResource(
    () => ({ q: debounced(), project: project(), profile: profile(), sort: sort(), dir: dir(), offset: offset() }),
    (key) =>
      fetchSessionsOverview({
        q: key.q || undefined,
        project: key.project || undefined,
        profile: key.profile || undefined,
        sort: key.sort,
        dir: key.dir,
        limit: PAGE,
        offset: key.offset,
      }),
  );
```

After the `projectOptions` memo (~lines 95-100), add:

```ts
  const profileOptions = createMemo(() => stats()?.profiles ?? []);
  const profileColors = createMemo(() => profileColorMap(stats()?.profiles ?? []));
```

- [ ] **Step 5: Replace the legend + time-chart block with a toolbar + mode toggle**

Replace the block from `<div class="chart-legend">` through the closing `</div>` of `.sessions-charts` (~lines 118-138) with:

```tsx
        <div class="chart-toolbar">
          <div class="chart-mode-toggle">
            <button type="button" classList={{ active: chartMode() === "type" }} onclick={() => setChartMode("type")}>by type</button>
            <button type="button" classList={{ active: chartMode() === "profile" }} onclick={() => setChartMode("profile")}>by account</button>
          </div>
          <Show when={chartMode() === "type"}>
            <div class="chart-legend">
              <button type="button" class="chart-legend-item" classList={{ off: !series().input }} onclick={() => toggleSeries("input")}><i class="tok-in" /> input</button>
              <button type="button" class="chart-legend-item" classList={{ off: !series().output }} onclick={() => toggleSeries("output")}><i class="tok-out" /> output</button>
              <button type="button" class="chart-legend-item" classList={{ off: !series().cache }} onclick={() => toggleSeries("cache")}><i class="tok-cache" /> cache</button>
            </div>
          </Show>
          <Show when={chartMode() === "profile"}>
            <div class="chart-legend">
              <For each={profileOptions()}>
                {(p) => <span class="chart-legend-item"><i style={{ background: profileColors()[p] }} /> {p}</span>}
              </For>
            </div>
          </Show>
        </div>

        <section class="sessions-chart-card">
          <h3 class="section-title">tokens · last 30 days</h3>
          <TokensOverTimeChart
            data={stats()?.tokensOverTime ?? []}
            series={series()}
            mode={chartMode()}
            profiles={profileOptions()}
            colors={profileColors()}
          />
        </section>

        <div class="sessions-charts">
          <section class="sessions-chart-card">
            <h3 class="section-title">tokens by project</h3>
            <TokensByProjectChart
              data={stats()?.tokensByProject ?? []}
              series={series()}
              onSelectProject={(id) => setProject(id ?? "none")}
            />
          </section>
          <section class="sessions-chart-card">
            <h3 class="section-title">tokens by account</h3>
            <TokensByProfileChart
              data={stats()?.tokensByProfile ?? []}
              series={series()}
              onSelectProfile={(p) => setProfile(p)}
            />
          </section>
        </div>
```

- [ ] **Step 6: Add the account dropdown to the controls**

In the `.sessions-controls` block, after the project `<select>` (~lines 148-151), add:

```tsx
        <select class="sessions-profile" value={profile()} onchange={(e) => setProfile(e.currentTarget.value)}>
          <option value="">all accounts</option>
          <For each={profileOptions()}>{(p) => <option value={p}>{p}</option>}</For>
        </select>
```

- [ ] **Step 7: Add the profile cell to each table row**

In the table body, after the project `<td>` (~line 195), add:

```tsx
                    <td class="muted">{s.project_name ?? "—"}</td>
                    <td class="muted">{profileLabel(s.profile)}</td>
```

- [ ] **Step 8: Add the toolbar + toggle CSS**

In `web/src/styles.css`, directly after the `.chart-legend*` rules (~line 704), add:

```css
.chart-toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.3rem; }
.chart-mode-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; font-size: 0.72rem; }
.chart-mode-toggle button { background: var(--bg-2); border: none; color: var(--fg-dim); padding: 0.2rem 0.6rem; cursor: pointer; font: inherit; }
.chart-mode-toggle button:hover { color: var(--fg); }
.chart-mode-toggle button.active { background: rgba(127, 127, 127, 0.25); color: var(--fg); }
```

Also add a `.sessions-profile` rule mirroring `.sessions-project` (after the `.sessions-project` rule ~line 730):

```css
.sessions-profile { background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg); padding: 0.35rem 0.5rem; font: inherit; }
```

- [ ] **Step 9: Run the page tests to verify they pass**

Run: `cd web && bunx vitest run tests/Sessions.test.tsx`
Expected: PASS (new tests plus the existing ones — the `cache` legend toggle test still works because `by type` is the default mode).

- [ ] **Step 10: Run the full web suite + typecheck**

Run: `cd web && bunx tsc --noEmit && bun run test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add web/src/pages/Sessions.tsx web/src/styles.css web/tests/Sessions.test.tsx
git commit -m "feat(sessions): account filter, column, by-account chart + time-chart mode toggle"
```

---

## Task 9: full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `bun run test:server && bun run test:web`
Expected: PASS across both.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Use the `run` skill (or `bun run dev:server` + `bun run dev:web`) and open the Sessions page. Confirm:
- "tokens by account" card renders one bar per profile; clicking a bar sets the account dropdown and filters the table.
- The account dropdown filters the table only (charts unchanged).
- The "tokens · last 30 days" card toggles between `by type` (input/output/cache legend) and `by account` (colored profile legend + per-profile stacks).
- The table shows a `profile` column ("unassigned" for untagged sessions) and is sortable via the header.

---

## Self-Review notes

- **Spec coverage:** dedicated by-profile chart (Task 6, wired Task 8); global account filter (Tasks 3, 4, 8); profile column, sortable (Tasks 3, 4, 8); time chart splittable by account (Tasks 2, 7, 8). Normalization (`null → "unassigned"`, `"default"` distinct) enforced in SQL (Tasks 1, 2) and display (Task 8 `profileLabel`). Filter-slices-table-only preserved (Task 8 wires `profile()` only into the `page` resource, not `stats`).
- **`profiles` ordering:** derived in the route from `tokensByProfile` (Task 3) so the by-account chart, the time-chart stacks, and the legend share one stable color order — a deliberate refinement of the spec's "return profiles" wording.
- **Type consistency:** `TokensByProfileRow`, `TokensOverTimePoint.byProfile`, `SessionsSort` `"profile"`, and the `profile` fetch param are defined server-side (Tasks 1-3) and mirrored in `web/src/api.ts` (Task 4) before any consumer uses them (Tasks 6-8).
- **No placeholders:** every code step is complete; the only advisory is the optional dataviz palette swap in Task 5, which ships with a working fallback.
