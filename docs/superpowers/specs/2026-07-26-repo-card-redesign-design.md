# Repo card redesign — design

**Date:** 2026-07-26
**Status:** approved, ready for planning

## Problem

`web/src/components/ProjectCard.tsx` renders one fixed card shape for every
project. Four things are wrong with it:

- **The name is a single truncating line.** `.card-name` sets
  `overflow: hidden; text-overflow: ellipsis`, and the name shares its row with
  a status dot, a group tag, a pin star, an archived tag, and three permanently
  visible action buttons. `multi-agent-profiles-and-launchers` becomes
  `multi-agent-profiles-…`, losing the part that identifies it.
- **Rows stretch to the tallest card.** `.grid` uses the default
  `align-items: stretch`, so one project with an issues list pads out its two
  row-mates with empty space.
- **Color means exactly one thing.** The dot is always git-or-error status.
  There is no way to ask "what did I leave running?" or "what have I not touched
  in months?"
- **Every card shows the same six fields**, whether or not any of them is
  interesting, and three of the fields the scanner already collects
  (`lastCommit.message`, `lastEdit`, container and process *names*) are never
  shown at all.

## Goals

- A card whose height reflects how much is actually happening on that project.
- A full-width colored title band, where the color is a dimension the user picks.
- Toolbar view presets, so the dashboard can serve triage, launching, and
  ambient monitoring without committing to one.
- Correct alignment: one control height across the toolbar, one icon box in the
  band.

## Non-goals

- **Server or scanner changes.** Everything below reads the existing
  `/api/projects` payload. The one feature that would need new server data
  (agent working/waiting state, see §2.4) is deferred rather than included.
- **"Open in editor."** Would need a new endpoint or a launcher-style PTY spawn.
  Different feature.
- **Per-project card configuration.** Presets are global to the dashboard.
- **Mobile (`/m`).** A separate surface with its own session-oriented list.
- **Masonry.** Cards size to content, but rows still reserve the tallest card's
  height. True masonry is a layout change with its own trade-offs.

## Decisions

| Question | Decision |
|---|---|
| Card identity | Solid full-width color band carrying the title (§1) |
| Title overflow | One line, ellipsis. Not multi-line. |
| Status dot | Removed — the band replaces it |
| Pin star | Removed — position conveys pinned (§6) |
| Card actions | One always-visible `☰` menu, right of the group tag (§4) |
| Color-by dimensions | `git` (default), `heat`, `services`, `agents`, `group`, `none` (§2) |
| Band foreground | Derived, never authored (§2.1) |
| Legend | Always shown in the toolbar |
| Content control | Three view presets: `compact`, `status`, `detail` (§3) |
| Preset + color-by storage | `localStorage`, per-device, via `preferences.ts` |
| Card height | `align-items: start` — cards size to content |

## 1. Card anatomy

```
┌─────────────────────────────────────────────┐
│ forest-public              [Personal] [☰]   │  ← band: --k bg, derived fg
├─────────────────────────────────────────────┤
│ task/i-want-ot-redesign-the-cards           │  ← branch, truncates from LEFT
│ [+4] [↑2] [2⚙] [:5173] [:52810]  3m         │  ← chip row, wraps
│ ⚠ docker: docker unreachable                │  ← only when errors non-empty
└─────────────────────────────────────────────┘
```

**Band.** Background `--k`, foreground `--kfg`, both set as inline custom
properties on the card element by `colorBy.ts`. Fixed
`min-height: calc(var(--icon-btn) + var(--band-pad) * 2)`.

**Title.** `flex: 1; min-width: 0`, one line, `text-overflow: ellipsis`. Takes
all width the right cluster does not need.

**Right cluster.** Fixed order, so the `☰` never shifts between cards:

1. `archived` tag — only when `project.hidden`
2. group tag — only when `project.group` is non-null
3. `☰` — always

Every element in the cluster draws from `currentColor`, so it inherits the
derived band foreground and needs no tokens of its own:

```css
.card-band-tag {
  color: inherit;
  border: 1px solid color-mix(in srgb, currentColor 38%, transparent);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
```

**Branch line.** Truncates from the *left* (`direction: rtl; text-align: left`)
so `task/i-want-ot-redesign-the-cards` keeps its identifying tail rather than its
`task/` prefix. This is the opposite of the title, deliberately.

**Click targets.** The card body navigates to the project. The `☰` and its
popover call `stopPropagation`, replacing today's `target.closest(".card-actions")`
guard at `ProjectCard.tsx:40`.

## 2. Color by

A `web/src/lib/colorBy.ts` module owns all six dimensions. It reads token hexes
from `currentTheme()` rather than CSS variables, following the precedent set by
`components/charts/profileColors.ts` — that is what makes consumers recolor on a
theme change, and it keeps the values usable from contexts a CSS variable would
not reach.

```ts
export type ColorByDimension = "git" | "heat" | "services" | "agents" | "group" | "none";

export type BandColor = { bg: string; fg: string };

export function bandColor(p: ProjectRow, dim: ColorByDimension, groups: string[]): BandColor;
export function legend(dim: ColorByDimension, groups: string[]): { label: string; swatch: string }[];
```

**No new `ThemeTokens` keys.** Everything derives from the existing 38.

### 2.1 The band foreground rule

A solid band needs a readable foreground *per hue*. Authoring that would be
16 themes × every band state, hand-tuned and contrast-tested. Instead one rule
derives it:

1. Take the better of the theme's own `bg` and `fg` against the hue.
2. If that clears **4.5:1**, use it — the band stays theme-flavored.
3. Otherwise use absolute black or white, whichever is better.

Step 3 is provably sufficient. For a hue of relative luminance `L`, contrast
against black is `(L + 0.05) / 0.05` and against white is `1.05 / (L + 0.05)`.
These are equal when `(L + 0.05)² = 0.0525`, i.e. `L ≈ 0.179`, where both equal
**4.58:1**. That crossover is the minimum of the maximum, so `max(black, white)`
is never below 4.58:1 for any color — comfortably above the 4.5:1 floor.

This matters because role hues in this repo are allowed to be low-contrast
against their own background: the existing catalog test floors them at 2.0:1,
noting Catppuccin Latte's green at 2.96:1 and its yellow at 2.31:1. Those hues
are fine as *marks* but cannot be assumed readable as *fills*.

### 2.2 `git` — the default

| State | Hue |
|---|---|
| `snapshot.errors` non-empty | `error` |
| `git.dirty` | `warn` |
| otherwise | `ok` |
| no snapshot | neutral |

Same precedence as today's `status()` at `ProjectCard.tsx:11`.

### 2.3 `heat` — activity recency

Buckets on `lastActivity(p)` from `lib/project-list.ts:6` (already the newest of
`lastEdit` and `lastCommit.timestamp`):

| Bucket | Band |
|---|---|
| < 24h | `accent` at 100% |
| < 7d | `accent` mixed 70% toward `bg` |
| < 30d | 45% |
| < 90d | 25% |
| ≥ 90d | `border` |
| never scanned | neutral (§2.6) |

A never-scanned project resolves to the neutral band under **every** dimension,
so "we have no data" reads the same way regardless of what is selected, and is
distinguishable from "we have data and it is cold" (`border`).

A single-hue sequential ramp, which is the correct form for ordered data. Mixing
happens numerically in `colorBy.ts` so the resulting hex is available to the
foreground rule in §2.1 — `color-mix()` in CSS would hide the result from JS.

### 2.4 `services` and `agents`

`services`: any running container or any listening process → `ok`; otherwise
neutral. Deliberately binary — "something is up" is the question being asked.

`agents`: `liveAgents` non-empty → `info`; otherwise neutral. Also binary, but
for a different reason: `server/src/routes/projects.ts:23` builds `liveAgents`
by counting PTY sessions grouped by detected agent name, and carries **no
working/waiting state**. That state lives in the transcript-ingestion path used
by the Sessions page and `/m`.

> **Follow-up, not in this scope.** Joining agent-session state into the project
> list payload would let `agents` distinguish waiting-on-you (`warn`) from
> working (`ok`), matching the existing `.session-chip-dot-*` convention in
> `styles.css:901`. That is a server change and belongs in its own spec.

### 2.5 `group` — categorical

Generalizes `profileColorMap` from `charts/profileColors.ts`: groups in a stable
sorted order map onto `chart1..chart8`, cycling. Ungrouped projects get the
neutral band. Not a status — a way to make a long grid spatially learnable.

### 2.6 `none` and the neutral band

`--k: var(--bg-3)`, `--kfg: var(--fg)`, plus a separator. See §5 for why that
separator is an inset shadow and not a border.

### 2.7 Legend

Always shown, right-aligned in the toolbar row. Necessary because the four role
hues are reused across dimensions — amber means "dirty" under `git` and "edited
this month" under `heat`. Swatch plus label per state, from `legend(dim, groups)`.

## 3. View presets

| Preset | Body |
|---|---|
| `compact` | One dim line: `branch · git summary · age`. No chips. |
| `status` *(default)* | Branch line, one wrapping chip row, issues line. |
| `detail` | Labelled rows: branch+git, commit message + age, edited, named services. |

`lib/dashboard-view.ts` holds the preset definitions and the pure chip-derivation
functions. A row or chip is omitted entirely when it has nothing to say — that,
plus `align-items: start`, is what makes height track content. An idle clean
project is two rows tall; a busy one is four or five.

Chips in `status`: dirty `+N`, ahead `↑N`, behind `↓N`, container running/stopped
counts, process count, distinct listening ports, `🤖 N`, relative age.

`detail` surfaces the three fields the current card ignores: `lastCommit.message`,
`lastEdit` as distinct from commit recency, and container/process *names*.

## 4. The actions menu

One `☰` button per card, always visible, last in the right cluster. Replaces the
three permanently visible buttons at `ProjectCard.tsx:60-69`.

Contents: `open`, `refresh`, `copy path`, separator, `pin`/`unpin`,
`archive`/`restore`.

- Always visible rather than hover-revealed, so touch and keyboard work without
  a special path.
- `refresh` is demoted from top-level because the dashboard already polls every
  5s when `autoRefresh` is on.
- `archive` is last and separated — a semi-destructive action earns a
  deliberate second step.
- `copy path` is new: two lines against `navigator.clipboard`, using
  `project.path`, which is already on `ProjectRow`.
- `open in editor` is explicitly excluded (non-goals).

New `components/CardMenu.tsx`. Click-to-open with a document click-outside
listener registered in the component body and removed via `onCleanup`, following
`LauncherButton.tsx:20-26`.

## 5. Alignment

Two defects, one cause: sizing things by text metrics instead of by a box.

### 5.1 The toolbar

`styles.css:982` gives `.search-input` `padding: 0.4rem 0.6rem`; `:984` gives
`.sort-select` `padding: 0.4rem 0.5rem`. Neither sets a height, so the native
`<select>` applies its own intrinsic metrics and lands a couple of pixels shy of
the input. **This is a pre-existing bug**, and adding two more controls would
compound it.

Fix: a `--control-h` token, with `height`, `box-sizing: border-box` and
`line-height: 1` on every control, plus `appearance: none` on the selects and a
CSS-drawn chevron so the UA stops having an opinion.

### 5.2 The icon button

Sizing a `☰` glyph with `line-height` makes both its box height and its optical
center depend on whichever font resolves. Fix:

- Fixed `--icon-btn` square, `display: inline-flex` with
  `align-items: center; justify-content: center`.
- An **inline SVG** of three lines rather than a text glyph, so no font is
  involved.
- Group and `archived` tags get that same `--icon-btn` height, so a card with a
  tag, one with an `archived` tag, and one with neither all yield an identical
  band.

### 5.3 The band never uses borders

A `1px` bottom border on the neutral band variant introduced a `0.5px` offset on
**every** card: `align-items: center` centers within the *content* box, which
excludes the border, while `background` paints *under* it — so the band's
optical center sat half a pixel below the icon. The rule: the band's separator
is `box-shadow: inset 0 -1px 0`, which paints inside without entering layout,
keeping content box and border box identical.

### 5.4 Verified geometry

Measured across 7 cards in the approved mockup, all single-valued:

| Property | Value |
|---|---|
| Band height | `32px` |
| Icon button | `20×20` |
| Icon inset from card's right edge | `7px` |
| Icon vertical offset from band center | `0` |
| Title vertical offset from band center | `0` |
| Toolbar control heights | `28px`, one shared top edge |

## 6. Pinned is conveyed by position

Dropping the pin star is only sound if position always conveys pinned. The
default view satisfies this — `Dashboard.tsx:72-85` renders a `pinned` section
above `all`. Search does not: `searchProjects` at `lib/project-list.ts:36`
merges visible and archived, then sorts by the chosen key with no regard to
`pinned`.

Fix: `searchProjects` sorts pinned first, then applies the chosen sort within
each partition. One change, and the invariant holds everywhere.

## 7. Module decomposition

| File | Change | Purpose |
|---|---|---|
| `lib/colorBy.ts` | new | Band colors + legend. Pure, theme-reading. |
| `lib/dashboard-view.ts` | new | Preset definitions + chip derivation. Pure. |
| `components/CardMenu.tsx` | new | `☰` button + popover. |
| `components/ProjectCard.tsx` | rewrite | Band, right cluster, body-by-preset. |
| `components/ProjectGrid.tsx` | edit | Thread preset through; `align-items: start`. |
| `pages/Dashboard.tsx` | edit | Preset control + color-by select + legend. |
| `lib/preferences.ts` | edit | `dashboardPreset`, `dashboardColorBy` signals. |
| `lib/project-list.ts` | edit | Hoist pinned in `searchProjects`. |
| `lib/themes/build.ts` | none | Confirmed unnecessary — §2.1 needs no tokens. |
| `styles.css` | edit | `--control-h`, `--icon-btn`, band, chips, toolbar fix. |
| `components/ServiceList.tsx` | delete | `ProjectCard` is its only consumer; superseded by chip derivation. |

The two pure `lib/` modules hold every branching decision, so the components
stay thin and the logic is unit-testable without rendering.

## 8. Testing

**New:**

- `colorBy` — every dimension maps the expected states; heat bucket boundaries;
  group cycling past 8; ungrouped and no-snapshot fall to neutral.
- **Band contrast floor** — for all 16 themes × every band state (including all
  five heat steps and all 8 group hues), `contrast(fg, bg) >= 4.5`, using the
  existing `tests/helpers/contrast.ts`. This is the test that makes §2.1 safe.
- `dashboard-view` — chip derivation per preset; empty rows omitted.
- `CardMenu` — opens on click, closes on outside click, items fire their
  callbacks, `archive`/`restore` swap on `hidden`.
- `project-list` — `searchProjects` returns pinned first.

**Rewritten.** Several assertions in `tests/ProjectCard.test.tsx` break *by
design* and should be rewritten rather than patched:

- `container.querySelector(".dot-error")` — the dot no longer exists; assert the
  band's `--k` instead.
- `screen.getByText("no services")` — the empty-services fallback is gone;
  absent chips are the new signal.
- `"2 terminals"` and `"🤖 2"` — chip labels move into `dashboard-view`.
- `tests/ProjectCard.archive.test.tsx` — archive now requires opening the menu.

## 9. Risks

- **Solid bands are loud.** Six of the sixteen themes are light, where a
  saturated band across a full grid is a bigger visual commitment than the
  current dot. Mitigated by `none` being a first-class dimension, and by the
  neutral band absorbing every no-signal state so a quiet dashboard stays quiet.
- **`ProjectCard` grows.** Three body shapes plus a band plus a menu is more
  than one component should hold; §7 pushes the branching into pure modules
  specifically to keep it from becoming the thing it replaced.
- **Preset names are guesses.** `compact` / `status` / `detail` may not survive
  contact with use. They are localStorage values, so renaming is cheap.
