# Single-line lifecycle panel with measured overflow — design

## Problem

The project-detail `LifecyclePanel` renders the top-level `forest.yaml`
controls on one row and then every named section on its own row beneath a
divider. With a couple of sections the panel is three or four lines tall, and
opening a "last run" box grows it further. The whole `forest.yaml` surface
should occupy **one line, and only one line**. Whatever does not fit at the
current width goes into a hamburger (`☰`) menu.

This supersedes the **UI** section of
`2026-09-04-forest-yaml-sections-design.md`. Everything server-side, the API
shape, the status model, and the dashboard card are unchanged.

## Decisions

- **Measured overflow, not a fixed rule.** Every group renders inline, left to
  right, top level first, then sections in the existing (name-sorted) order.
  Groups that do not fit the row's width collapse from the right into a `☰`
  menu. Resizing the window moves groups in and out live.
- **Last-run output is a floating popover**, not an inline `<details>`. The
  row never grows.
- **Measurement uses a hidden measuring row**, not wrap detection or fixed
  breakpoints. The visible row is never clipped, so popovers use the same
  absolute-positioning pattern as the existing card menu.
- **A small shared `Popover` primitive** backs both the `☰` menu and the
  last-run panels. `CardMenu` and `LauncherButton` keep their own hand-rolled
  handling for now (out of scope).

## Layout

```
[chip] [Open ↗] [Start] [Stop] last run │ game [healthy] [Open ↗] [Start] [Stop] last run │ editor [Start]
```

When the row is narrower than that:

```
[chip] [Open ↗] [Start] [Stop] last run │ game [healthy] [Open ↗] [Start] [Stop] last run    [☰]
                                                                                    ┌───────────────┐
                                                                                    │ editor        │
                                                                                    │ [Start]       │
                                                                                    └───────────────┘
```

### Groups

The row's items are **groups**. Group 0 is the top-level lifecycle; groups
1..n are the named sections. Each group renders, in order:

1. **Name** — the section name in bold (`.lifecycle-section-name`). The
   top-level group has no name.
2. **Status chip** — top level: always (as today, including `none`). Section:
   only when status is not `none` (as today).
3. **Open ↗** — same visibility rules as today: top level and health sections
   only while up; launcher sections always when a `url` exists.
4. **Start** / **Stop** — when the group has that command. Section buttons keep
   their `aria-label` of `Start <name>` / `Stop <name>`.
5. **last run** — a small text button, present only when the group has a last
   run with output. Opens the last-run popover (below).

The top-level group's content depends on state exactly as today: with no
`forest.yaml` it is the chip plus the "No `forest.yaml`" hint; with a config
that is not enabled it is the chip plus the **Enable lifecycle** button;
enabled, it is the full control set. Sections are appended only when enabled.

Groups are separated by a thin vertical rule (`.lifecycle-sep`).

Error banners (action errors, fetch errors) remain a separate block **above**
the row, shown only while an error exists. They are not part of the
`forest.yaml` line.

### Last-run source of truth

Each group's last run comes from the polled view only: `view.lastRun` for the
top level and `section.lastRun` for a section. The panel's local `output`
signal (set from the run result before `refetch`) is removed. `refetch()` is
awaited immediately after every run, so the polled value is available at the
same moment; one source per group also keeps section output out of the
top-level popover by construction.

## Components

### `web/src/lib/overflow.ts` — pure fit calculation

```ts
/**
 * How many leading items fit in `width`. `rights[i]` is the right edge of
 * item i when all items are laid out unconstrained (so it already includes
 * separators and gaps before it). If every item fits, all are visible.
 * Otherwise `reserve` (the ☰ trigger's width plus one gap) is subtracted and
 * the count of items whose right edge fits in the remainder is returned.
 */
export function visibleCount(rights: number[], width: number, reserve: number): number;
```

Rules: empty `rights` → 0. All `rights[i] <= width` → `rights.length`. Else
the number of leading items with `rights[i] <= width - reserve` (0 when even
the first does not fit).

### `web/src/components/Popover.tsx` — primitive

Controlled disclosure with click-outside and Escape.

```ts
type PopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger. `ref` must be attached to the focusable element. */
  trigger: (t: { ref: (el: HTMLElement) => void; toggle: () => void; expanded: () => boolean }) => JSX.Element;
  /** Which edge of the trigger the panel aligns to. Default "left". */
  align?: "left" | "right";
  /** Extra class on the panel. */
  panelClass?: string;
  children: JSX.Element;   // panel content; rendered only while open
};
```

Behaviour:

- Root is `div.popover-root` (`position: relative; display: inline-flex`).
  Panel is `div.popover-panel` with `.align-left` / `.align-right`, absolutely
  positioned below the trigger (`top: calc(100% + 5px)`), `z-index: 20`,
  same surface styling as `.card-menu-popover`.
- While open, a `document` click listener closes the popover when the click
  target is outside the root (the `contains` guard from `CardMenu` — Solid's
  delegated events mean a child's `stopPropagation` does not prevent the
  native document listener from seeing the click). The listener is attached
  only while open.
- `Escape` on the root closes the popover, returns focus to the trigger, and
  calls `stopPropagation()` so a popover nested inside another popover closes
  one level at a time.
- Clicking controls inside the panel does **not** close it (the `☰` menu
  stays open after Start/Stop so the user can watch the chip change).
- The trigger render prop should set `aria-expanded={expanded()}`.

### `web/src/components/OverflowRow.tsx` — generic measured overflow

```ts
type Place = "inline" | "menu" | "measure";
type OverflowRowProps<T> = {
  items: T[];
  /** Render one item for a placement. Called via <Index>, so `item` is an accessor. */
  children: (item: () => T, place: Place) => JSX.Element;
  /** Rendered before every item except the first, inline and in the measuring row. */
  separator?: () => JSX.Element;
  /** aria-label / title for the ☰ trigger. Default "more". */
  menuLabel?: string;
  /** When true, the ☰ trigger gets the `alert` class. Receives the hidden items. */
  menuAlert?: (hidden: T[]) => boolean;
};
```

DOM:

```
div.overflow-root                 (position: relative)
  div.overflow-row                (flex, nowrap, gap, align-items center, min-width 0)
    div.overflow-item × visibleCount   ([separator] + children(item, "inline"))
    Popover (align right, panelClass "overflow-menu") — only when hidden.length > 0
      trigger: button.overflow-more (margin-left: auto; same look as .card-menu-trigger, ☰ SVG)
      panel:   div.overflow-menu-item × hidden.length  (children(item, "menu"))
  div.overflow-measure  aria-hidden="true" inert   (absolute, 0×0, overflow hidden, visibility hidden, pointer-events none)
    div.overflow-strip            (flex, nowrap, same gap, width: max-content)
      div.overflow-item × items.length  ([separator] + children(item, "measure"))
      button.overflow-more (static clone, for width)
```

Measurement (`measure()`):

1. `width = row.clientWidth` (the row has no padding, so this is the content
   width).
2. `rights[i] = item.offsetLeft + item.offsetWidth` for each `.overflow-item`
   in the strip. The measuring container is positioned, so offsets are
   relative to it and start at 0.
3. `reserve = moreClone.offsetWidth + gap`, where `gap` is
   `parseFloat(getComputedStyle(row).columnGap) || 0`.
4. `setVisibleCount(visibleCount(rights, width, reserve))`.

Triggers: a `ResizeObserver` on `.overflow-row` (container width) and on
`.overflow-strip` (content width changes when chips/buttons change), plus one
`measure()` on mount. When `ResizeObserver` is undefined (jsdom) the panel
measures once on mount and again whenever `props.items.length` changes. In
jsdom all offsets are 0, so everything fits and nothing is hidden unless a
test stubs the geometry.

Why the strip is nested inside a 0×0 clipped container: an absolutely
positioned element that is merely `visibility: hidden` still contributes to
scrollable overflow, so a wide measuring row would add a horizontal
scrollbar. Clipping it at 0×0 prevents that; the strip keeps its natural
width, and observing the strip (not the clipped container) still fires on
content changes. `flex: 0 0 auto` on items keeps them from shrinking.

`hidden = items.slice(visibleCount)`. The `☰` trigger renders only when
`hidden.length > 0`. It carries `aria-label`/`title` from `menuLabel` and the
`alert` class when `menuAlert?.(hidden)` is true.

### `web/src/components/LifecyclePanel.tsx`

Keeps its data, polling, optimistic pending, and action handlers. It builds a
`LifecycleGroup[]` view model and renders it through `OverflowRow`:

```ts
type LifecycleGroup = {
  key: string;                 // "" for the top level, else section name
  name: string | null;
  status: LifecycleStatus;     // optimistic pending applied
  showChip: boolean;           // top level: true; section: status !== "none"
  url?: string;
  showLink: boolean;
  canStart: boolean;
  canStop: boolean;
  onStart: () => void;
  onStop: () => void;
  lastRun: { output: string; failed: boolean; at: number } | null;
  /** Top-level only: hint / Enable button when not enabled. */
  gate?: "no-config" | "enable";
};
```

A `LifecycleGroupView` render function takes `(group, place, busy)`:

- `place === "inline"` / `"measure"`: `div.lifecycle-group` (inline-flex) with
  the elements listed under **Groups**.
- `place === "menu"`: `div.lifecycle-group.menu` — the name (when present) on
  its own line above the same controls, wrapped in `div.lifecycle-group-controls`.
- `place === "measure"`: identical markup, but `LastRunButton` is rendered
  non-interactive (trigger only, no popover, no auto-open effect). The
  measuring copy is `inert` anyway; this just avoids running effects twice.

`menuAlert` returns true when any hidden group's `lastRun?.failed` is true, so
a failure inside the `☰` menu is still visible from the row.

Separator: `<span class="lifecycle-sep" />`.

### `LastRunButton` (inside `LifecyclePanel.tsx`)

```ts
props: { lastRun: { output: string; failed: boolean; at: number }; label: string; interactive: boolean }
```

- Trigger: `button.lifecycle-lastrun` with text `last run`, `aria-label`
  `${label} last run` (label is `lifecycle` for the top level, else the section name), and class `failed` while `lastRun.failed`.
- Panel (`Popover`, align left, panelClass `lifecycle-lastrun-panel`):
  a `<pre>` with the output. Same `pre` styling as today's
  `.lifecycle-output pre` (max-height, scroll, wrap).
- **Auto-open on failure:** when `interactive`, an effect watches
  `lastRun.at`. When it changes from a previously observed value *and* the new
  run is failed, the popover opens. It does **not** open on mount for a stale
  failure; the red trigger conveys that. This is a deliberate narrowing of
  today's `<details open>` behaviour, which also re-opened on every visit.
- The popover is rendered only inline and in the `☰` menu. A hidden group's
  failure therefore surfaces as the `alert` tint on `☰` plus the red trigger
  once the menu is open.

## Styling (`web/src/styles.css`)

Remove `.lifecycle-sections`, `.lifecycle-section`, `.lifecycle-output`,
`.lifecycle-output[open]`, `.lifecycle-output summary`, `.lifecycle-output pre`.

Add:

- `.lifecycle-panel` — block; keeps `padding: 0.5rem 1.2rem; border-bottom`.
  Banners inside it get `margin: -0.5rem -1.2rem 0.5rem` so they span the
  panel edge to edge above the row.
- `.lifecycle-group { display: inline-flex; align-items: center; gap: 0.4rem; }`
- `.lifecycle-group.menu { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; }`
  with an inner `.lifecycle-group-controls` inline-flex row.
- `.lifecycle-sep { width: 1px; height: 1.1rem; background: var(--border); }`
- `.lifecycle-lastrun` — text button: `font: inherit; font-size: 0.8rem;
  color: var(--fg-dim); background: none; border: 0; padding: 0.25rem 0.2rem;
  cursor: pointer; border-bottom: 1px dotted currentColor;`
  `.lifecycle-lastrun.failed { color: var(--error); }`
- `.lifecycle-lastrun-panel { min-width: 20rem; max-width: min(40rem, 90vw); padding: 0.4rem; }`
  and `.lifecycle-lastrun-panel pre` (the old `.lifecycle-output pre` rules).
- `.popover-root`, `.popover-panel`, `.popover-panel.align-left { left: 0 }`,
  `.popover-panel.align-right { right: 0 }` — surface matches
  `.card-menu-popover`.
- `.overflow-root`, `.overflow-row`, `.overflow-row > * { flex: 0 0 auto }`,
  `.overflow-more` (reuses the `.card-menu-trigger` look; `margin-left: auto`),
  `.overflow-more.alert { color: var(--error); }`,
  `.overflow-measure`, `.overflow-strip`,
  `.overflow-menu { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem; min-width: 12rem; }`,
  `.overflow-menu-item + .overflow-menu-item { border-top: 1px solid var(--border); padding-top: 0.4rem; }`.

`.lifecycle-btn`, `.lifecycle-link`, `.lifecycle-section-name`, and `.chip`
are unchanged.

## Docs

- Add a "Superseded" note to the UI section of
  `2026-09-04-forest-yaml-sections-design.md` pointing here.
- `skills/forest-yaml/SKILL.md` describes buttons "in the project panel"
  without layout detail; no change needed.

## Testing

No new frameworks. Vitest + `@solidjs/testing-library` in jsdom.

- **`web/tests/overflow.test.ts`** — `visibleCount`: empty → 0; all fit →
  length; partial fit reserves `reserve`; first item too wide → 0; an item
  that fits without the reserve but not with it is hidden.
- **`web/tests/Popover.test.tsx`** — closed by default; trigger toggles;
  outside click closes; inside click keeps open; Escape closes, returns focus
  to the trigger, and stops propagation; `aria-expanded` follows state.
- **`web/tests/OverflowRow.test.tsx`** — with default (zero) geometry every
  item is inline and no `☰` renders. With stubbed geometry
  (`Object.defineProperty` on `HTMLElement.prototype` for `offsetLeft`,
  `offsetWidth`, `clientWidth`, driven by `data-w` attributes set by the test's
  render callback) items past the width are absent from the row (outside the
  `aria-hidden` measuring copy), `☰` renders, and opening it lists exactly the
  hidden items rendered with `place === "menu"`. `menuAlert` toggles the
  `alert` class. Measuring copy is `aria-hidden` and `inert`, so role queries
  never match it.
- **`web/tests/LifecyclePanel.test.tsx`** — all existing tests stay green
  (everything inline in jsdom). Add:
  - a group with `lastRun` renders a `last run` button; clicking it shows the
    output in a popover.
  - a failed run arriving after a Start (fetch mock resolves to a failed
    `lastRun` on the second call) auto-opens the popover and tints the trigger.
  - a stale failed `lastRun` on first load tints the trigger but does not
    open the popover.
  - a section with output opens its own popover containing only that
    section's output; the top-level trigger is absent when the top level has
    no last run.
  - the `☰` alert tint appears when a hidden section has a failed last run
    (uses the same geometry stub as the `OverflowRow` test).

## Out of scope

- Dashboard card and mobile pages (they do not render this panel).
- Migrating `CardMenu` / `LauncherButton` to `Popover`.
- Keyboard arrow navigation inside the `☰` menu (native Tab order suffices).
- Reordering or prioritising which groups overflow first (always from the
  right).
