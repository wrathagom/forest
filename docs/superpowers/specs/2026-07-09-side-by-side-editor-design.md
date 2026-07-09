# Side-by-side file editing

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

Forest's project detail view has a single center pane (`.terminal-area`). Every
tab kind — terminal, file, diff, commit, session, task — is an absolutely
positioned sibling stacked at `inset: 0`, and exactly one of them is visible at
a time, selected by a single `activeId` signal.

That makes it impossible to look at two files at once. The user wants to
**compare two files visually**: read file A and file B together, with both fully
editable, so a fix spotted mid-comparison can be made on the spot.

This is comparison by adjacency, not by diff. Forest computes nothing about the
relationship between the two files. (Forest does have a `diff` tab kind, but it
is git-scoped — a file against `HEAD` — and does not compare two arbitrary
paths. That remains true after this change.)

## Scope

- A second, right-hand pane in the center area, holding one file editor.
- Both panes fully editable: independent dirty state, `Mod-S` save, conflict
  banner.
- A draggable splitter between them, with a persisted width.
- Two ways to send a file right: a button on its tab, and alt-click in the file
  tree.
- Graceful collapse to a single pane on narrow viewports.

Explicitly **not** in scope: diff computation between the two files, editor
groups with independent tab strips, more than two panes, drag-to-split, and a
keyboard shortcut for splitting.

## Approach

Three approaches were considered.

**A dedicated `compare` tab** holding both paths was rejected. A file open both
as a normal tab and inside a compare tab would get two independent CodeMirror
views on one path, each with its own dirty state and its own 2-second disk
poller. Those views fight: save in one, and the other's poller sees a changed
mtime and raises a conflict banner against a write the user just made. Fixing
that requires a shared per-path document store — real work, caused entirely by
the choice of tab model.

**Full editor groups** (two panes, each with its own tab strip and active tab,
tabs draggable between them) were rejected as more than the goal requires. It
means reshaping `activeId` into per-group state, parameterizing and duplicating
`TabStrip`, and changing the persistence shape.

**A second pane pointer** was chosen. Keep the single tab strip and single
`activeId`; add one signal naming the tab pinned to the right pane. Its decisive
property is that **a file has exactly one editor** — pinning moves a tab rather
than copying a file — which makes A's duplicate-view problem structurally
impossible instead of merely handled. It is also the change the existing code is
shaped for: the center pane already mounts tabs by matching an id, so this goes
from matching one id to matching two.

## State model

Two new signals in `ProjectDetail.tsx`, beside `activeId`:

```ts
const [secondaryId, setSecondaryId] = createSignal<string | null>(loadSecondaryTab(params.id));
const [splitRatio, setSplitRatio] = createSignal<number>(loadSplitRatio(params.id)); // 0.2–0.8
```

`secondaryId` is the tab pinned to the right pane: always a `file:` id, or null.

### Invariants

These hold at all times, and every transition below exists to preserve them:

1. If `secondaryId` is non-null, it names a file tab that exists in `fileTabs`.
2. **`secondaryId !== activeId`.** One file, one editor.

Invariant 2 is the reason this approach was chosen. It is asserted in every
`panes.test.ts` case.

### Mental model

Asymmetric, deliberately: **the left pane is what the tab strip drives; the
right pane is pinned.** The user clicks through tabs on the left as they do
today while the right pane holds still. That matches what comparison feels like
— one file being navigated, one held in view.

`activeId` may name any tab kind. Only `secondaryId` is restricted to files.
This means a terminal on the left with a file pinned on the right works, with
the terminal still mounted exactly once and its existing `ResizeObserver`
(`TerminalView.tsx:40`) reflowing the PTY when the splitter moves.

### Transitions

| Action | Result |
|---|---|
| Split file F right | `secondaryId ← file:F`. If F was active, `activeId` moves to the next tab that isn't F. |
| Click tab X in strip | If X is the pinned tab, unpin it (`secondaryId ← null`) and make it active. Otherwise `activeId ← X`. |
| Close tab X | If X is pinned, clear the pin. If X is active, `activeId` moves to the next tab that isn't the pinned one. |

"The next tab" everywhere means the first tab, in the display order of the
`tabs()` memo (`ProjectDetail.tsx:144-195`: terminals, files, diffs, commits,
sessions, tasks), that is neither the tab being removed nor the pinned one. This
matches the existing `tabs().find((t) => t.id !== id)` behaviour at
`ProjectDetail.tsx:294` and `:309`, extended with the pinned exclusion. Null if
no such tab exists.

Clicking the pinned tab to bring it back is the same gesture as the ◨ button on
that tab — one toggle in two places.

**Degenerate case.** Splitting when no other tab exists would leave the left pane
empty. Splitting a file right when it is the only tab therefore opens it on the
left as normal. Split is meaningless with one file.

These three transitions live in a new `web/src/lib/panes.ts` as pure functions,
`(state, action) → state` over `{ tabs, activeId, secondaryId }`, rather than
inline in the component. All the sharp edges are here, and purity makes each one
unit-testable without mounting Solid.

## UI surface

### Split button

`TabStrip.tsx` takes a `secondaryId` prop and an `onSplitRight` callback. File
tabs get a ◨ button beside the existing `.tab-kill`, revealed on hover exactly
as `×` is. On the pinned tab it stays visible and means "return to left." The
pinned tab carries a `pinned` class for a persistent marker.

### Alt-click in the file tree

`FileTreePanel.tsx:127` currently routes a git-modified file to `onOpenDiff`.
The modifier check must run **before** that branch, or alt-clicking a modified
file would try to pin a diff to the right pane and violate invariant 1:

```ts
const onFileClick = (node: Node, e: MouseEvent) => {
  if (e.altKey) { props.onOpenFileRight(node.path); return; }   // always the file, never the diff
  if (node.gitStatus && node.gitStatus !== "!") props.onOpenDiff(node.path);
  else props.onOpenFile(node.path);
};
```

`InfoPane` threads `onOpenFileRight` through. Its `activeFilePath: () => string
| null` prop becomes `highlightedPaths: () => string[]` so the tree highlights
both open files; the comparison at `FileTreePanel.tsx:145` becomes an `includes`.

### Splitter

A new `PaneResizer.tsx`: `pointerdown` → `setPointerCapture`, `pointermove` →
ratio from the container's `getBoundingClientRect()`, clamped to 0.2–0.8,
`pointerup` → release and persist. Pointer capture rather than window listeners,
so the drag survives the cursor crossing into a CodeMirror instance. It carries
`role="separator"`, `aria-orientation="vertical"`, and arrow-key nudges — a 6px
drag target must not be the only interaction path.

### Layout

`.terminal-area` becomes a grid whose DOM shape is identical split or not, so
splitting never remounts the left pane's views:

```css
.terminal-area { display: grid; grid-template-columns: 1fr; }
.terminal-area.split { grid-template-columns: var(--split-left) 6px 1fr; }
.pane { position: relative; min-width: 0; min-height: 0; }
.pane > .terminal-host,
.pane > .file-editor,
.pane > .session-transcript { position: absolute; inset: 0; }
```

`--split-left` is set inline from `splitRatio()`. The three existing
`.terminal-area > …` direct-child rules (`styles.css:108-110`) move to `.pane >
…`; all three break once views are nested inside a pane.

The right pane renders only `<For each={fileTabs}>` guarded by `<Show
when={secondaryId() === \`file:${f.path}\`}>`.

`FileEditor.tsx` is **not modified.** It is already a self-contained,
path-keyed component with per-instance dirty state, save keymap, and poller. All
the work is in deciding where to mount it.

### Narrow screens

A media query collapses the split to one column and hides the right pane and the
resizer. `secondaryId` stays in state, so widening the window restores the split.

This goes in `styles.css` (which already carries three media queries), **not**
in `web/src/pages/mobile/mobile.css` — that file is scoped to the separate
mobile page surface, is imported only by `MobileLayout.tsx`, and is never loaded
by `ProjectDetail`.

## Persistence

Two keys added to `tabs.ts`, using its existing `read`/`write` helpers:
`forest.secondaryTab.<projectId>` and `forest.splitRatio.<projectId>`. Ratio
writes are debounced so a drag does not hammer `localStorage`.

`localStorage` is untrusted input — it survives sessions in which files were
deleted, renamed, or closed elsewhere. Loading therefore validates rather than
trusts, re-establishing the invariants at the boundary:

- `loadSecondaryTab` returns `null` unless the value is a `file:` id **and**
  names a path present in `loadOpenFiles(projectId)` **and** differs from
  `loadActiveTab(projectId)`.
- `loadSplitRatio` clamps to 0.2–0.8 and falls back to 0.5 on anything
  non-finite.

A pinned file whose tab exists but whose file was deleted on disk needs no
handling: `FileEditor` already renders its own load error, as it does today for
a stale tab.

## Edge cases

Each follows from the invariants rather than being a special case:

- **Last non-pinned tab closed.** `activeId` becomes null; the left pane shows
  the existing `.terminal-empty` fallback while the right keeps its file. The
  split is lopsided, which is coherent, and the transition table produces it
  with no extra code.
- **Project switch.** `secondaryId` is cleared, matching how `diffTabs` /
  `commitTabs` are cleared at `ProjectDetail.tsx:125-137`.
- **Clean terminal exit** (`onSessionExit`) picks the next tab, which must skip
  the pinned one — the same "next tab that isn't secondary" helper the close
  path uses.

## Testing

`web/tests/panes.test.ts` (new) exercises the transition table directly, with no
DOM: split-when-active, split-the-only-tab, click-the-pinned-tab,
close-the-pinned-tab, close-the-active-tab-adjacent-to-pinned. Every case
asserts `activeId !== secondaryId`.

Extending existing suites:

- `tabs.test.ts` — load-validation cases: secondary not in open files, secondary
  equal to active, non-finite ratio.
- `TabStrip.test.tsx` — the ◨ button shows on file tabs and not terminal tabs;
  clicking the pinned tab unpins rather than merely selecting.
- `ProjectDetail.tabLeak.test.tsx` — `secondaryId` does not bleed across
  projects.
- `FileTreePanel` — alt-click on a git-modified file opens it as a file on the
  right, not as a diff.

## Files touched

In dependency order:

| File | Change |
|---|---|
| `web/src/lib/panes.ts` | new — pure transitions + invariants |
| `web/src/lib/tabs.ts` | validating `loadSecondaryTab`/`saveSecondaryTab`, `loadSplitRatio`/`saveSplitRatio` |
| `web/src/components/PaneResizer.tsx` | new — pointer-capture splitter |
| `web/src/components/TabStrip.tsx` | ◨ button, `secondaryId` prop, pinned marker |
| `web/src/components/FileTreePanel.tsx` | alt-click before the git branch; `highlightedPaths` |
| `web/src/components/InfoPane.tsx` | thread `onOpenFileRight`, `highlightedPaths` |
| `web/src/pages/ProjectDetail.tsx` | two signals, wire `panes.ts`, render two panes |
| `web/src/styles.css` | `.pane` rules; move the three `.terminal-area >` selectors; media query collapsing the split |

`web/src/components/FileEditor.tsx` is unchanged.
