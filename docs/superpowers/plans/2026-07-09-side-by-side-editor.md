# Side-by-side File Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pin one file to a right-hand pane in the project detail view, so two files can be read and edited side by side.

**Architecture:** The center pane (`.terminal-area`) currently shows exactly one tab, chosen by a single `activeId` signal. We add a second signal, `secondaryId`, naming a file tab pinned to a right-hand pane. The left pane stays tab-strip-driven; the right pane holds still. The invariant `activeId !== secondaryId` guarantees a file never gets two CodeMirror views (which would give it two dirty flags and two duelling disk pollers). All state transitions live in a new pure module, `web/src/lib/panes.ts`, so every edge case is testable without a DOM.

**Tech Stack:** SolidJS (signals + `createStore`, **not** React), CodeMirror 6, Vitest + `@solidjs/testing-library`, plain CSS Grid. Package manager and runner: Bun.

**Spec:** `docs/superpowers/specs/2026-07-09-side-by-side-editor-design.md`

**Key facts about this codebase you will need:**

- `web/src/pages/ProjectDetail.tsx` owns all tab state. There is no Redux/zustand/context — it's Solid signals and stores in one component.
- Each tab kind has its own store (`fileTabs`, `diffTabs`, …) and a `createMemo<Tab[]>` at lines 144-195 flattens them into display order: **terminals, files, diffs, commits, sessions, tasks**.
- Tab ids are strings like `file:src/x.ts`, `term:<uuid>`, `diff:src/x.ts`.
- `TerminalView` is **always mounted** and toggled with a `visible` prop, because it owns a live xterm + WebSocket. `FileEditor` is mounted/unmounted with `<Show>`. This asymmetry is why only *file* tabs may be pinned right — rendering `TerminalView` in two panes would create two xterm instances per PTY.
- `FileEditor.tsx` is **not modified by this plan.** It is already self-contained and path-keyed: its own dirty state, its own `Mod-S` keymap, its own 2-second disk poller.

**Run tests from the repo root with `bun run test:web`, or a single file with `cd web && bunx vitest run tests/<file>`.**

**Typecheck baseline — read this before running `tsc`.** `bunx tsc --noEmit` is *not* part of `bun run test:web` (which is just `vitest run`), and the repo does **not** currently typecheck clean. On the commit this plan was written against there are **22 pre-existing `error TS` lines**:

| File | Errors | Cause |
|---|---|---|
| `src/pages/ProjectDetail.tsx` | 15 | `params.id` is `string \| undefined` under the router's types |
| `src/pages/Settings.tsx` | 2 | same family |
| `src/App.tsx` | 1 | resource refetch signature |
| 4 test files | 1 each | same family |

Do **not** try to fix these; they are out of scope. The gate for every task in this plan is:

1. `bun run test:web` passes, **and**
2. `bunx tsc --noEmit` reports no error that names a symbol this plan introduces — `panes`, `PaneState`, `secondaryId`, `onToggleSplit`, `PaneResizer`, `highlightedPaths`, `onOpenFileRight`, `clampRatio`, `splitRatio`.

A raw error *count* is a bad gate for Task 7, which rewrites `ProjectDetail.tsx` and will shift those 15 line numbers around. Grep the output for the new symbols instead:

```sh
cd web && bunx tsc --noEmit 2>&1 | grep -E 'panes|PaneState|secondaryId|onToggleSplit|PaneResizer|highlightedPaths|onOpenFileRight|clampRatio|splitRatio' || echo "clean: no errors from this plan's symbols"
```

---

### Task 1: Pure pane-transition module

This is the heart of the feature. Everything else is wiring. `panes.ts` has no Solid imports and no DOM access — it is a set of pure functions over `{ tabs, activeId, secondaryId }`.

**Files:**
- Create: `web/src/lib/panes.ts`
- Test: `web/tests/panes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/panes.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { splitRight, selectTab, closeTab, reconcilePanes, type PaneState } from "../src/lib/panes";
import type { Tab } from "../src/lib/tabs";

const term: Tab = { kind: "terminal", id: "term:1", sessionId: "1", label: "term 1", agent: null };
const fileA: Tab = { kind: "file", id: "file:a.ts", path: "a.ts", label: "a.ts", dirty: false };
const fileB: Tab = { kind: "file", id: "file:b.ts", path: "b.ts", label: "b.ts", dirty: false };

/** Invariant 2 from the spec: a file never has two editors. */
function assertInvariant(s: PaneState) {
  if (s.activeId !== null) expect(s.activeId).not.toBe(s.secondaryId);
}

describe("splitRight", () => {
  test("pins a non-active file, leaving activeId alone", () => {
    const s = splitRight([term, fileA, fileB], { activeId: "term:1", secondaryId: null }, "file:b.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:b.ts" });
    assertInvariant(s);
  });

  test("pinning the active file moves activeId to the next tab", () => {
    const s = splitRight([term, fileA], { activeId: "file:a.ts", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("splitting the only tab opens it left instead — split is meaningless with one file", () => {
    const s = splitRight([fileA], { activeId: "file:a.ts", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
    assertInvariant(s);
  });

  test("a null activeId is filled from the remaining tabs rather than left empty", () => {
    const s = splitRight([term, fileA], { activeId: null, secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("refuses non-file ids — terminals may never be pinned right", () => {
    const before: PaneState = { activeId: "file:a.ts", secondaryId: null };
    expect(splitRight([term, fileA], before, "term:1")).toEqual(before);
  });

  test("refuses unknown ids", () => {
    const before: PaneState = { activeId: "file:a.ts", secondaryId: null };
    expect(splitRight([fileA], before, "file:gone.ts")).toEqual(before);
  });

  test("re-pinning the already-pinned file is a no-op", () => {
    const before: PaneState = { activeId: "term:1", secondaryId: "file:b.ts" };
    expect(splitRight([term, fileA, fileB], before, "file:b.ts")).toEqual(before);
  });
});

describe("selectTab", () => {
  test("clicking a normal tab makes it active", () => {
    const s = selectTab({ activeId: "term:1", secondaryId: "file:b.ts" }, "file:a.ts");
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: "file:b.ts" });
    assertInvariant(s);
  });

  test("clicking the pinned tab unpins it and makes it active", () => {
    const s = selectTab({ activeId: "term:1", secondaryId: "file:b.ts" }, "file:b.ts");
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: null });
    assertInvariant(s);
  });
});

describe("closeTab", () => {
  test("closing the pinned tab clears the pin and leaves activeId alone", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: "file:b.ts" }, "file:b.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
    assertInvariant(s);
  });

  test("closing the active tab skips over the pinned one when picking the next", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: "file:a.ts" }, "term:1");
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("closing the last non-pinned tab leaves activeId null and the pin intact", () => {
    const s = closeTab([term, fileA], { activeId: "term:1", secondaryId: "file:a.ts" }, "term:1");
    expect(s).toEqual({ activeId: null, secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("closing an inactive, unpinned tab changes nothing", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
  });
});

describe("reconcilePanes", () => {
  test("drops a pinned id whose tab no longer exists", () => {
    const s = reconcilePanes([term], { activeId: "term:1", secondaryId: "file:gone.ts" });
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
  });

  test("drops a non-file pinned id", () => {
    const s = reconcilePanes([term, fileA], { activeId: "file:a.ts", secondaryId: "term:1" });
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
  });

  test("replaces a stale activeId with the first tab that is not pinned", () => {
    const s = reconcilePanes([term, fileA], { activeId: "term:gone", secondaryId: "term:1" });
    // "term:1" is not a file id, so the pin is dropped first, then activeId falls to term:1.
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
    assertInvariant(s);
  });

  test("a stale activeId never resolves to the pinned file — the invariant-2 regression", () => {
    // This is the bug in ProjectDetail.tsx:103, which falls back to fileTabs[0]
    // with no knowledge of the pin.
    const s = reconcilePanes([fileA, fileB], { activeId: "term:gone", secondaryId: "file:a.ts" });
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("unpins rather than blanking when the pinned file is the only tab left", () => {
    const s = reconcilePanes([fileA], { activeId: "term:gone", secondaryId: "file:a.ts" });
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
    assertInvariant(s);
  });

  test("no tabs at all yields a fully empty state", () => {
    expect(reconcilePanes([], { activeId: "term:1", secondaryId: "file:a.ts" })).toEqual({
      activeId: null,
      secondaryId: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/panes.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/panes"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/panes.ts`:

```ts
import type { Tab } from "./tabs";

/**
 * Which tab each pane shows. `activeId` is the left pane and may name any tab
 * kind. `secondaryId` is the right pane and is always a `file:` id or null —
 * only FileEditor can be safely mounted twice in one page, because TerminalView
 * owns a live PTY connection.
 *
 * Invariant: activeId !== secondaryId. That is what guarantees a file never has
 * two CodeMirror views, and therefore never has two dirty flags or two disk
 * pollers fighting each other.
 */
export type PaneState = { activeId: string | null; secondaryId: string | null };

const FILE_PREFIX = "file:";

export function isFileId(id: string | null): id is string {
  return typeof id === "string" && id.startsWith(FILE_PREFIX);
}

/** First tab in display order that is not excluded. Null when none remains. */
function nextTab(tabs: Tab[], exclude: (string | null)[]): string | null {
  const skip = new Set(exclude.filter((x): x is string => x !== null));
  return tabs.find((t) => !skip.has(t.id))?.id ?? null;
}

/** Pin a file tab to the right pane. */
export function splitRight(tabs: Tab[], state: PaneState, fileId: string): PaneState {
  if (!isFileId(fileId)) return state;
  if (!tabs.some((t) => t.id === fileId)) return state;
  if (state.secondaryId === fileId) return state;

  const replacement = nextTab(tabs, [fileId]);
  // Nothing would remain on the left. A split with one file is meaningless, so
  // just open it normally.
  if (replacement === null) return { activeId: fileId, secondaryId: null };

  const activeId = state.activeId === fileId || state.activeId === null ? replacement : state.activeId;
  return { activeId, secondaryId: fileId };
}

/** Click a tab in the strip. Clicking the pinned tab brings it back to the left. */
export function selectTab(state: PaneState, id: string): PaneState {
  if (state.secondaryId === id) return { activeId: id, secondaryId: null };
  return { activeId: id, secondaryId: state.secondaryId };
}

/**
 * Close a tab. `tabs` is the list *before* removal — the caller mutates its
 * store afterwards.
 */
export function closeTab(tabs: Tab[], state: PaneState, id: string): PaneState {
  const secondaryId = state.secondaryId === id ? null : state.secondaryId;
  if (state.activeId !== id) return { activeId: state.activeId, secondaryId };
  return { activeId: nextTab(tabs, [id, secondaryId]), secondaryId };
}

/**
 * Re-establish both invariants against the live tab list. Used after the
 * sessions poll (tabs can vanish when a PTY dies elsewhere) and after loading
 * persisted state.
 */
export function reconcilePanes(tabs: Tab[], state: PaneState): PaneState {
  const ids = new Set(tabs.map((t) => t.id));

  let secondaryId = state.secondaryId;
  if (secondaryId !== null && (!isFileId(secondaryId) || !ids.has(secondaryId))) secondaryId = null;

  let activeId = state.activeId;
  if (activeId !== null && !ids.has(activeId)) activeId = null;
  if (activeId === null) activeId = nextTab(tabs, [secondaryId]);

  // The pinned file is the only tab left: unpin rather than show a blank left pane.
  if (activeId === null && secondaryId !== null) {
    activeId = secondaryId;
    secondaryId = null;
  }
  if (activeId !== null && activeId === secondaryId) secondaryId = null;

  return { activeId, secondaryId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/panes.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/panes.ts web/tests/panes.test.ts
git commit -m "feat(panes): pure pane-transition module with invariant tests"
```

---

### Task 2: Persistence for the pinned tab and split ratio

`localStorage` is untrusted input: it outlives file deletions, renames, and tabs closed in another browser tab. `loadSecondaryTab` therefore validates rather than trusts, re-establishing the spec's invariants at the boundary.

**Files:**
- Modify: `web/src/lib/tabs.ts` (append after `saveActiveTab`, line 43)
- Test: `web/tests/tabs.test.ts` (append inside the existing `describe`)

- [ ] **Step 1: Write the failing test**

In `web/tests/tabs.test.ts`, extend the import at line 2-10 to add the four new functions plus `clampRatio`:

```ts
import {
  loadOpenFiles,
  saveOpenFiles,
  loadActiveTab,
  saveActiveTab,
  loadExpandedDirs,
  saveExpandedDirs,
  loadSecondaryTab,
  saveSecondaryTab,
  loadSplitRatio,
  saveSplitRatio,
  clampRatio,
  type Tab,
} from "../src/lib/tabs";
```

Then append these two `describe` blocks to the end of the file (after the existing `describe("tabs persistence", …)` closes):

```ts
describe("secondaryTab persistence", () => {
  test("round-trips a valid pinned file", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveActiveTab("p1", "term:1");
    saveSecondaryTab("p1", "file:src/foo.ts");
    expect(loadSecondaryTab("p1")).toBe("file:src/foo.ts");
  });

  test("defaults to null", () => {
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a pin whose file is not open", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveSecondaryTab("p1", "file:src/gone.ts");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a pin equal to the active tab — invariant 2", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveActiveTab("p1", "file:src/foo.ts");
    saveSecondaryTab("p1", "file:src/foo.ts");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a non-file id", () => {
    saveSecondaryTab("p1", "term:1");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects garbage", () => {
    localStorage.setItem("forest.secondaryTab.p1", JSON.stringify(42));
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("is per-project", () => {
    saveOpenFiles("p1", ["a"]);
    saveOpenFiles("p2", ["b"]);
    saveSecondaryTab("p1", "file:a");
    saveSecondaryTab("p2", "file:b");
    expect(loadSecondaryTab("p1")).toBe("file:a");
    expect(loadSecondaryTab("p2")).toBe("file:b");
  });
});

describe("splitRatio persistence", () => {
  test("defaults to 0.5", () => {
    expect(loadSplitRatio("p1")).toBe(0.5);
  });

  test("round-trips", () => {
    saveSplitRatio("p1", 0.35);
    expect(loadSplitRatio("p1")).toBe(0.35);
  });

  test("clamps an out-of-range stored value", () => {
    saveSplitRatio("p1", 0.99);
    expect(loadSplitRatio("p1")).toBe(0.8);
    saveSplitRatio("p1", 0.01);
    expect(loadSplitRatio("p1")).toBe(0.2);
  });

  test("falls back to 0.5 on non-finite or non-numeric values", () => {
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(clampRatio("0.4" as unknown)).toBe(0.5);
    expect(clampRatio(null)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/tabs.test.ts`
Expected: FAIL — `loadSecondaryTab is not a function` (or a TS resolve error on the import).

- [ ] **Step 3: Write the implementation**

In `web/src/lib/tabs.ts`, insert after `saveActiveTab` (currently ends line 43) and before `loadExpandedDirs`:

```ts
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
const DEFAULT_RATIO = 0.5;

export function clampRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export function saveSecondaryTab(projectId: string, id: string | null): void {
  write(`secondaryTab.${projectId}`, id);
}

/**
 * The tab pinned to the right pane. localStorage outlives file deletions and
 * tabs closed elsewhere, so this validates the spec's invariants rather than
 * trusting what it reads: the id must name a `file:` tab that is currently
 * open, and must not be the active tab.
 */
export function loadSecondaryTab(projectId: string): string | null {
  const raw = read<unknown>(`secondaryTab.${projectId}`, null);
  if (typeof raw !== "string" || !raw.startsWith("file:")) return null;
  if (!loadOpenFiles(projectId).includes(raw.slice("file:".length))) return null;
  if (raw === loadActiveTab(projectId)) return null;
  return raw;
}

export function saveSplitRatio(projectId: string, ratio: number): void {
  write(`splitRatio.${projectId}`, ratio);
}

export function loadSplitRatio(projectId: string): number {
  return clampRatio(read<unknown>(`splitRatio.${projectId}`, DEFAULT_RATIO));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/tabs.test.ts`
Expected: PASS — the 6 original tests plus 11 new ones.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tabs.ts web/tests/tabs.test.ts
git commit -m "feat(tabs): validating persistence for pinned tab and split ratio"
```

---

### Task 3: The splitter component

Pointer capture rather than `window` listeners, so the drag survives the cursor crossing into a CodeMirror instance. `onRatio` fires continuously during the drag (cheap, drives layout); `onCommit` fires once at the end (writes `localStorage`). That's why no debounce is needed.

Note `setPointerCapture` does not exist in jsdom, hence the optional calls.

**Files:**
- Create: `web/src/components/PaneResizer.tsx`
- Test: `web/tests/PaneResizer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/tests/PaneResizer.test.tsx`:

```tsx
import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import PaneResizer from "../src/components/PaneResizer";

function setup(ratio = 0.5) {
  const onRatio = vi.fn();
  const onCommit = vi.fn();
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, width: 1000, top: 0, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const { container: root } = render(() => (
    <PaneResizer ratio={() => ratio} onRatio={onRatio} onCommit={onCommit} container={() => container} />
  ));
  return { onRatio, onCommit, el: root.querySelector(".pane-resizer") as HTMLElement };
}

describe("PaneResizer", () => {
  test("exposes separator semantics for keyboard and screen-reader users", () => {
    const { el } = setup(0.5);
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  test("arrow keys nudge the ratio", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onRatio).toHaveBeenCalledWith(0.52);
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(onRatio).toHaveBeenCalledWith(0.48);
  });

  test("arrow-key nudges clamp at the bounds and commit", () => {
    const { onRatio, onCommit, el } = setup(0.8);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onRatio).toHaveBeenCalledWith(0.8);
    expect(onCommit).toHaveBeenCalled();
  });

  test("unrelated keys are ignored", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.keyDown(el, { key: "a" });
    expect(onRatio).not.toHaveBeenCalled();
  });

  test("dragging reports the pointer position as a fraction of the container", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 300 });
    expect(onRatio).toHaveBeenCalledWith(0.3);
  });

  test("a drag past the edge clamps rather than collapsing a pane", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 5 });
    expect(onRatio).toHaveBeenCalledWith(0.2);
  });

  test("pointer movement without a preceding pointerdown does nothing", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 300 });
    expect(onRatio).not.toHaveBeenCalled();
  });

  test("pointerup ends the drag and commits once", () => {
    const { onRatio, onCommit, el } = setup(0.5);
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 300 });
    expect(onRatio).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/PaneResizer.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/components/PaneResizer"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/PaneResizer.tsx`:

```tsx
import { clampRatio, MIN_RATIO, MAX_RATIO } from "../lib/tabs";

const NUDGE = 0.02;

/**
 * Draggable divider between the two center panes.
 *
 * Uses pointer capture rather than window listeners so the drag survives the
 * cursor crossing into a CodeMirror instance. `onRatio` fires continuously
 * (drives layout); `onCommit` fires once when the gesture ends (persists).
 */
export default function PaneResizer(props: {
  ratio: () => number;
  onRatio: (ratio: number) => void;
  onCommit: () => void;
  container: () => HTMLElement | undefined;
}) {
  let dragging = false;

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    dragging = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const el = props.container();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    props.onRatio(clampRatio((e.clientX - rect.left) / rect.width));
  };

  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!dragging) return;
    dragging = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    props.onCommit();
  };

  // A 6px drag target must not be the only way to move this.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") props.onRatio(clampRatio(props.ratio() - NUDGE));
    else if (e.key === "ArrowRight") props.onRatio(clampRatio(props.ratio() + NUDGE));
    else return;
    e.preventDefault();
    props.onCommit();
  };

  return (
    <div
      class="pane-resizer"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="resize panes"
      aria-valuenow={Math.round(props.ratio() * 100)}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onkeydown={onKeyDown}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/PaneResizer.test.tsx`
Expected: PASS — 8 tests.

Two environment hazards to expect, both in jsdom rather than in your code:

1. **Float equality.** If `ArrowRight` from `0.5` reports `0.52000000000000002` rather than `0.52`, switch that assertion to `expect(onRatio.mock.calls[0][0]).toBeCloseTo(0.52)`.
2. **`PointerEvent`.** Older jsdom has no `PointerEvent` constructor, so `fireEvent.pointerMove(el, { clientX: 300 })` can dispatch a plain `Event` that drops `clientX`, making the drag tests fail with `NaN`. If that happens, dispatch a `MouseEvent` (which jsdom does implement, and which carries `clientX`) under the pointer event's name:

```tsx
const pointer = (el: HTMLElement, type: string, init: MouseEventInit = {}) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

// then: pointer(el, "pointerdown"); pointer(el, "pointermove", { clientX: 300 });
```

`setPointerCapture` does not exist in jsdom at all, which is why the component calls it optionally.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PaneResizer.tsx web/tests/PaneResizer.test.tsx
git commit -m "feat(panes): pointer-capture splitter with keyboard support"
```

---

### Task 4: Split button on file tabs

The ◨ button toggles: on an unpinned file tab it means "send right"; on the pinned tab it means "bring back". `ProjectDetail` resolves which, so `TabStrip` stays dumb.

**Files:**
- Modify: `web/src/components/TabStrip.tsx`
- Test: `web/tests/TabStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/TabStrip.test.tsx`, inside the existing `describe("TabStrip", …)` block, just before its closing `});`:

```tsx
  test("file tabs get a split button", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeTruthy();
  });

  test("terminal tabs get no split button — a PTY cannot be mounted twice", () => {
    const { container } = render(() => (
      <TabStrip tabs={[termTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeNull();
  });

  test("no split button when the host provides no onToggleSplit", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeNull();
  });

  test("clicking the split button calls onToggleSplit and not onSelect", () => {
    const onToggleSplit = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={onSelect} onClose={() => {}} onToggleSplit={onToggleSplit} {...defaultLauncherProps} />
    ));
    fireEvent.click(container.querySelector(".tab-split")!);
    expect(onToggleSplit).toHaveBeenCalledWith("file:src/x.ts");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the pinned tab gets a pinned class", () => {
    const { container } = render(() => (
      <TabStrip tabs={[termTab, fileTab]} activeId="term:1" secondaryId="file:src/x.ts" onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const pinned = container.querySelector(".tab.pinned");
    expect(pinned?.textContent).toContain("x.ts");
  });

  test("the pinned tab's split button is titled as a way back", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} secondaryId="file:src/x.ts" onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const btn = container.querySelector(".tab-split") as HTMLElement;
    expect(btn.title).toBe("return to left pane");
  });

  test("an unpinned file tab's split button is titled as a way right", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const btn = container.querySelector(".tab-split") as HTMLElement;
    expect(btn.title).toBe("open in right pane");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/TabStrip.test.tsx`
Expected: FAIL — the new tests fail on `container.querySelector(".tab-split")` being null; TS also rejects the unknown `onToggleSplit` / `secondaryId` props.

- [ ] **Step 3: Write the implementation**

Replace the whole body of `web/src/components/TabStrip.tsx` with:

```tsx
import { For, Show } from "solid-js";
import type { Tab } from "../lib/tabs";
import LauncherButton, { type LauncherEntry } from "./LauncherButton";

export default function TabStrip(props: {
  tabs: Tab[];
  activeId: string | null;
  secondaryId?: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleSplit?: (id: string) => void;
  onLaunch: (entry: LauncherEntry) => void;
  launchers: LauncherEntry[];
  lastUsedLauncher: string | null;
  onChangeLastUsedLauncher: (id: string) => void;
  infoExpanded?: () => boolean;
  onToggleInfo?: () => void;
}) {
  const handleClose = (e: MouseEvent, t: Tab) => {
    e.stopPropagation();
    if (t.kind === "file" && t.dirty) {
      const ok = confirm(`${t.label} has unsaved changes — discard?`);
      if (!ok) return;
    }
    props.onClose(t.id);
  };

  const handleSplit = (e: MouseEvent, t: Tab) => {
    e.stopPropagation();
    props.onToggleSplit!(t.id);
  };

  return (
    <div class="tab-strip">
      <For each={props.tabs}>
        {(t) => (
          <div
            class={`tab tab-${t.kind} ${props.activeId === t.id ? "active" : ""} ${
              props.secondaryId === t.id ? "pinned" : ""
            } ${t.kind === "file" && t.dirty ? "dirty" : ""}`}
            title={t.kind === "terminal" && t.agent ? t.agent : undefined}
            onclick={() => props.onSelect(t.id)}
          >
            <span class="tab-label">
              {t.kind === "file" && t.dirty ? "● " : ""}
              {t.kind === "terminal" && t.agent ? "🤖 " : ""}
              {t.label}
            </span>
            {/* Only file tabs may be pinned right: TerminalView owns a live PTY
                and must never be mounted in two panes at once. */}
            <Show when={t.kind === "file" && props.onToggleSplit}>
              <button
                class="tab-split"
                title={props.secondaryId === t.id ? "return to left pane" : "open in right pane"}
                onclick={(e) => handleSplit(e, t)}
              >
                ◨
              </button>
            </Show>
            <button class="tab-kill" title="close" onclick={(e) => handleClose(e, t)}>
              ×
            </button>
          </div>
        )}
      </For>
      <LauncherButton
        launchers={props.launchers}
        lastUsedId={props.lastUsedLauncher}
        onLaunch={props.onLaunch}
        onChangeLastUsed={props.onChangeLastUsedLauncher}
      />
      <Show when={props.onToggleInfo}>
        <button
          class="info-toggle"
          onclick={() => props.onToggleInfo!()}
          title={props.infoExpanded?.() ? "hide info pane" : "show info pane"}
        >
          {props.infoExpanded?.() ? "‹ hide" : "› info"}
        </button>
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/TabStrip.test.tsx`
Expected: PASS — the 11 original tests plus 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TabStrip.tsx web/tests/TabStrip.test.tsx
git commit -m "feat(tabs): split button and pinned marker on file tabs"
```

---

### Task 5: Alt-click in the file tree

The modifier check must run **before** the git-status branch. `onFileClick` currently sends a git-modified file to `onOpenDiff`; if alt-click fell through to that, it would try to pin a `diff:` tab to the right pane, violating invariant 1.

This task also swaps `activeFilePath: string | null` for `highlightedPaths: string[]`, so the tree can highlight both open files.

**Files:**
- Modify: `web/src/components/FileTreePanel.tsx` (props at 60-66; `onFileClick` at 127-131; row class at 145-147)
- Modify: `web/tests/FileTreePanel.test.tsx`

> **Correction (found during execution).** An earlier draft of this plan said no test file existed for this component and told the implementer to create one. That was wrong — `web/tests/FileTreePanel.test.tsx` already exists with 10 tests covering rendering, dir expansion, git badges, the dirty-ancestor class, `localStorage` persistence, and lazy-load + retry. Those tests use the old `activeFilePath` prop and **must be migrated to `highlightedPaths`, not replaced.** Merge the new cases in; preserve every existing assertion.

- [ ] **Step 1: Write the failing test**

Create `web/tests/FileTreePanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach } from "vitest";
import FileTreePanel from "../src/components/FileTreePanel";
import type { TreeEntry } from "../src/api";

const entries: TreeEntry[] = [
  { path: "clean.ts", type: "file", gitStatus: null },
  { path: "modified.ts", type: "file", gitStatus: "M" },
  { path: "ignored.ts", type: "file", gitStatus: "!" },
];

function setup(highlightedPaths: string[] = []) {
  const onOpenFile = vi.fn();
  const onOpenDiff = vi.fn();
  const onOpenFileRight = vi.fn();
  const { container } = render(() => (
    <FileTreePanel
      projectId="p1"
      entries={entries}
      highlightedPaths={highlightedPaths}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
      onOpenFileRight={onOpenFileRight}
    />
  ));
  return { onOpenFile, onOpenDiff, onOpenFileRight, container };
}

beforeEach(() => localStorage.clear());

describe("FileTreePanel", () => {
  test("plain click on a clean file opens it", () => {
    const { onOpenFile, onOpenDiff } = setup();
    fireEvent.click(screen.getByText("clean.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("clean.ts");
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  test("plain click on a git-modified file opens its diff", () => {
    const { onOpenFile, onOpenDiff } = setup();
    fireEvent.click(screen.getByText("modified.ts"));
    expect(onOpenDiff).toHaveBeenCalledWith("modified.ts");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  test("alt-click on a clean file opens it in the right pane", () => {
    const { onOpenFile, onOpenFileRight } = setup();
    fireEvent.click(screen.getByText("clean.ts"), { altKey: true });
    expect(onOpenFileRight).toHaveBeenCalledWith("clean.ts");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  test("alt-click on a git-modified file opens the FILE right, never the diff", () => {
    const { onOpenDiff, onOpenFileRight } = setup();
    fireEvent.click(screen.getByText("modified.ts"), { altKey: true });
    expect(onOpenFileRight).toHaveBeenCalledWith("modified.ts");
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  test("alt-click on a gitignored file opens it right", () => {
    const { onOpenFileRight } = setup();
    fireEvent.click(screen.getByText("ignored.ts"), { altKey: true });
    expect(onOpenFileRight).toHaveBeenCalledWith("ignored.ts");
  });

  test("every highlighted path is marked active, not just one", () => {
    const { container } = setup(["clean.ts", "modified.ts"]);
    const active = [...container.querySelectorAll(".tree-file-active")].map((el) => el.textContent);
    expect(active.length).toBe(2);
    expect(active.join(" ")).toContain("clean.ts");
    expect(active.join(" ")).toContain("modified.ts");
  });

  test("an unhighlighted file is not marked active", () => {
    const { container } = setup(["clean.ts"]);
    expect(container.querySelectorAll(".tree-file-active").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bunx vitest run tests/FileTreePanel.test.tsx`
Expected: FAIL — TS rejects `highlightedPaths` / `onOpenFileRight`, and the alt-click tests fail because `onOpenDiff` is called for `modified.ts`.

- [ ] **Step 3: Write the implementation**

In `web/src/components/FileTreePanel.tsx`, change the props block (currently lines 60-66) to:

```tsx
export default function FileTreePanel(props: {
  projectId: string;
  entries: TreeEntry[];
  highlightedPaths: string[];
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFileRight: (path: string) => void;
}) {
```

Replace `onFileClick` (currently lines 127-131) with:

```tsx
  const onFileClick = (node: Node, e: MouseEvent) => {
    // Alt-click pins the file to the right pane. This must be checked BEFORE the
    // git-status branch below: only `file:` tabs may be pinned, so alt-clicking a
    // modified file has to open the file, not its diff.
    if (e.altKey) {
      props.onOpenFileRight(node.path);
      return;
    }
    // "!" marks a gitignored file — open it normally; ignored files have no diff.
    if (node.gitStatus && node.gitStatus !== "!") props.onOpenDiff(node.path);
    else props.onOpenFile(node.path);
  };
```

In the file row (currently lines 145-150), change the active-class test and the click handler:

```tsx
            <div
              class={`tree-row tree-file ${
                props.highlightedPaths.includes(p.node.path) ? "tree-file-active" : ""
              } ${p.node.gitStatus ? `tree-file-${p.node.gitStatus}` : ""}`}
              style={indent}
              onclick={(e) => onFileClick(p.node, e)}
            >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bunx vitest run tests/FileTreePanel.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FileTreePanel.tsx web/tests/FileTreePanel.test.tsx
git commit -m "feat(tree): alt-click opens a file in the right pane"
```

---

### Task 6: Thread the new props through InfoPane

`InfoPane` is a pass-through here. It has no tests of its own; Task 5 and Task 7 cover both ends. This task exists so the tree compiles against its host.

**Files:**
- Modify: `web/src/components/InfoPane.tsx` (props at 18-26; `FileTreePanel` usage at 58-64)

- [ ] **Step 1: Update the props type**

In `web/src/components/InfoPane.tsx`, change the props block (lines 18-26) — `activeFilePath` becomes `highlightedPaths`, and `onOpenFileRight` is added:

```tsx
export default function InfoPane(props: {
  projectId: string;
  expanded: () => boolean;
  highlightedPaths: () => string[];
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFileRight: (path: string) => void;
  onOpenCommit: (sha: string) => void;
  onOpenSession: (sessionId: string, label: string) => void;
  onOpenTask: (taskId: string, title: string) => void;
}) {
```

- [ ] **Step 2: Update the FileTreePanel call site**

Replace lines 58-64:

```tsx
              <FileTreePanel
                projectId={props.projectId}
                entries={tree()!.entries}
                highlightedPaths={props.highlightedPaths()}
                onOpenFile={props.onOpenFile}
                onOpenDiff={props.onOpenDiff}
                onOpenFileRight={props.onOpenFileRight}
              />
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -E 'highlightedPaths|onOpenFileRight'`
Expected: errors pointing at `ProjectDetail.tsx`, which still passes `activeFilePath` and omits `onOpenFileRight`. That is the *only* new breakage; Task 7 fixes it. (Ignore the 22 pre-existing errors described in the header.) Do not commit a broken tree — go straight to Task 7 and commit the two together.

---

### Task 7: Wire it into ProjectDetail

The big one. Six changes: reorder the `tabs` memo, add the two signals, route every transition through `panes.ts`, fix the poll's invariant-2 bug, clear state on project switch, and render two panes.

**Files:**
- Modify: `web/src/pages/ProjectDetail.tsx`

- [ ] **Step 1: Move the `tabs` memo above `refetchSessions`**

`refetchSessions` will call `reconcilePanes(tabs(), …)`, so `tabs` must be initialized first. The memo only reads the stores declared at lines 43-50, so this reorder is safe.

Cut the `const tabs = createMemo<Tab[]>(…)` block (currently lines 144-195) and paste it verbatim immediately after the `closedSessions` declaration (currently line 77), before `const refetchSessions`.

- [ ] **Step 2: Add imports**

Change the import block at lines 17-23 to:

```ts
import {
  loadOpenFiles,
  saveOpenFiles,
  loadActiveTab,
  saveActiveTab,
  loadSecondaryTab,
  saveSecondaryTab,
  loadSplitRatio,
  saveSplitRatio,
  type Tab,
} from "../lib/tabs";
import { splitRight, selectTab, closeTab, reconcilePanes, type PaneState } from "../lib/panes";
```

- [ ] **Step 3: Add the two signals and their persistence**

After `const [activeId, setActiveId] = createSignal<string | null>(loadActiveTab(params.id));` (line 51), add:

```ts
  const [secondaryId, setSecondaryId] = createSignal<string | null>(loadSecondaryTab(params.id));
  const [splitRatio, setSplitRatio] = createSignal<number>(loadSplitRatio(params.id));
```

After the `saveActiveTab` effect (lines 69-71), add:

```ts
  createEffect(() => {
    saveSecondaryTab(tabsProjectId, secondaryId());
  });
```

Split ratio is *not* persisted by an effect — a drag fires `onRatio` on every pointermove and would hammer `localStorage`. It is written once per gesture, from `onCommit` in Step 8.

Add a helper next to the signals, used by every transition below:

```ts
  const panes = (): PaneState => ({ activeId: activeId(), secondaryId: secondaryId() });
  const applyPanes = (next: PaneState) => {
    setActiveId(next.activeId);
    setSecondaryId(next.secondaryId);
  };
```

- [ ] **Step 4: Fix the invariant-2 bug in `refetchSessions`**

The `untrack` block (lines 85-106) hand-rolls active-tab validation and, at line 103, falls back to `fileTabs[0]` with no knowledge of the pin — which can make the pinned file active in *both* panes. Replace the whole `untrack(() => { … });` block with:

```ts
      // If the persisted active/pinned tabs no longer correspond to live tabs,
      // transition. reconcilePanes also enforces activeId !== secondaryId, which
      // the old hand-rolled fallback to fileTabs[0] did not.
      untrack(() => applyPanes(reconcilePanes(tabs(), panes())));
```

- [ ] **Step 5: Clear pane state on project switch**

In the project-switch effect (lines 125-137), inside the `untrack` callback, after `setActiveId(loadActiveTab(id));` add:

```ts
      setSecondaryId(loadSecondaryTab(id));
      setSplitRatio(loadSplitRatio(id));
```

- [ ] **Step 6: Route select / close / exit through `panes.ts`**

Replace `onSelect` (line 263):

```ts
  const onSelect = (id: string) => applyPanes(selectTab(panes(), id));
```

Replace `onClose` (lines 265-297). Note `next` is computed from `tabs()` **before** the store mutation removes the tab, and applied after:

```ts
  const onClose = async (id: string) => {
    const tab = tabs().find((t) => t.id === id);
    if (!tab) return;
    const next = closeTab(tabs(), panes(), id);
    if (tab.kind === "terminal") {
      try {
        await killSession(tab.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      const remaining = state.rows.filter((s) => s.id !== tab.sessionId);
      setState("rows", reconcile(remaining, { key: "id", merge: true }));
    } else if (tab.kind === "file") {
      const remaining = fileTabs.filter((f) => f.path !== tab.path);
      setFileTabs(reconcile(remaining));
    } else if (tab.kind === "diff") {
      const remaining = diffTabs.filter((d) => d.path !== tab.path);
      setDiffTabs(reconcile(remaining));
    } else if (tab.kind === "commit") {
      const remaining = commitTabs.filter((c) => c.sha !== tab.sha);
      setCommitTabs(reconcile(remaining));
    } else if (tab.kind === "session") {
      const remaining = sessionTabs.filter((s) => s.sessionId !== tab.sessionId);
      setSessionTabs(reconcile(remaining));
    } else if (tab.kind === "task") {
      const remaining = taskTabs.filter((t) => t.taskId !== tab.taskId);
      setTaskTabs(reconcile(remaining));
    }
    applyPanes(next);
  };
```

Replace the tail of `onSessionExit` (lines 308-311) — the `if (activeId() === tabId) { … }` block — with:

```ts
    applyPanes(closeTab(tabs(), panes(), tabId));
```

`closeTab` is a no-op on the panes when the exiting terminal was neither active nor pinned, so this is safe to call unconditionally. Note `tabs()` is read *after* `setState("rows", …)` here; that's fine, because `closeTab` excludes `tabId` explicitly.

- [ ] **Step 7: Add the split and open-right actions**

> **Correction (found in code review).** This plan originally left `openFile` alone. That was a **critical bug**. `openFile` is the *only* `setActiveId` call site that sets a `file:` id — every other one sets `term:`/`diff:`/`commit:`/`session:`/`task:`, which can never equal `secondaryId`. So normal-clicking the pinned file in the tree (or DiffView's "edit file" button) set `activeId === secondaryId`, mounting two `FileEditor`s on one path — two dirty flags, two disk pollers — until the 10-second poll's `reconcilePanes` silently dropped the pin. `openFile` **must** route through `selectTab`:
>
> ```ts
>   const openFile = (path: string) => {
>     const id = `file:${path}`;
>     if (!fileTabs.some((f) => f.path === path)) {
>       setFileTabs((prev) => [...prev, { path, dirty: false }]);
>     }
>     // Must go through selectTab, not setActiveId: this is the only setActiveId
>     // call site that sets a `file:` id, so it is the only one that can collide
>     // with the pinned tab. selectTab unpins when you select the pinned file.
>     applyPanes(selectTab(panes(), id));
>   };
> ```
>
> Regression test: `web/tests/ProjectDetail.panes.test.tsx`, which renders the real `InfoPane` + `FileTreePanel` and clicks the pinned file's tree row.

After `openFile` (lines 203-209), add:

```ts
  /** ◨ button: send a file right, or bring the pinned one back. */
  const toggleSplit = (id: string) => {
    if (secondaryId() === id) applyPanes(selectTab(panes(), id));
    else applyPanes(splitRight(tabs(), panes(), id));
  };

  /** Alt-click in the file tree: open the file straight into the right pane. */
  const openFileRight = (path: string) => {
    if (!fileTabs.some((f) => f.path === path)) {
      setFileTabs((prev) => [...prev, { path, dirty: false }]);
    }
    applyPanes(splitRight(tabs(), panes(), `file:${path}`));
  };
```

Replace `activeFilePath` (lines 197-201) with a helper for each pane plus the tree's highlight list:

```ts
  const filePathOf = (id: string | null) =>
    id !== null && id.startsWith("file:") ? id.slice("file:".length) : null;
  const activeFilePath = () => filePathOf(activeId());
  const secondaryFilePath = () => filePathOf(secondaryId());
  const highlightedPaths = () =>
    [activeFilePath(), secondaryFilePath()].filter((p): p is string => p !== null);
```

- [ ] **Step 8: Render two panes**

Add a ref for the grid container next to the signals:

```ts
  let areaRef: HTMLDivElement | undefined;
```

Pass the new props to `TabStrip` (lines 335-346) — add `secondaryId` and `onToggleSplit` beside the existing ones:

```tsx
      <TabStrip
        tabs={tabs()}
        activeId={activeId()}
        secondaryId={secondaryId()}
        onSelect={onSelect}
        onClose={onClose}
        onToggleSplit={toggleSplit}
        onLaunch={onLaunch}
        launchers={launchersRes() ?? []}
        lastUsedLauncher={lastUsedLauncher()}
        onChangeLastUsedLauncher={setLastUsedLauncher}
        infoExpanded={infoExpanded}
        onToggleInfo={() => setInfoExpanded(!infoExpanded())}
      />
```

Now the center area. Replace the opening tag of `.terminal-area` (line 350) with the grid host, and wrap the entire existing `<Show when={tabs().length > 0} …>` block (lines 351-466) in a `<div class="pane pane-left">`. Then add the resizer and the right pane after it, before `</div>`:

```tsx
      <div
        class={`terminal-area ${secondaryId() !== null ? "split" : ""}`}
        ref={areaRef}
        style={{ "--split-left": `${splitRatio() * 100}%` }}
      >
        <div class="pane pane-left">
          {/* ---- the existing <Show when={tabs().length > 0} …> block, unchanged ---- */}
        </div>
        <Show when={secondaryId() !== null}>
          <PaneResizer
            ratio={splitRatio}
            onRatio={setSplitRatio}
            onCommit={() => saveSplitRatio(tabsProjectId, splitRatio())}
            container={() => areaRef}
          />
          <div class="pane pane-right">
            <For each={fileTabs}>
              {(f) => (
                <Show when={secondaryId() === `file:${f.path}`}>
                  <FileEditor
                    projectId={params.id}
                    path={f.path}
                    onDirtyChange={(dirty) => setFileDirty(f.path, dirty)}
                  />
                </Show>
              )}
            </For>
          </div>
        </Show>
      </div>
```

Import the resizer at the top, next to the other component imports:

```ts
import PaneResizer from "../components/PaneResizer";
```

Finally, update the `InfoPane` call site (lines 468-477):

```tsx
      <InfoPane
        projectId={params.id}
        expanded={infoExpanded}
        highlightedPaths={highlightedPaths}
        onOpenFile={openFile}
        onOpenDiff={openDiff}
        onOpenFileRight={openFileRight}
        onOpenCommit={openCommit}
        onOpenSession={openSessionTab}
        onOpenTask={openTask}
      />
```

- [ ] **Step 9: Verify the whole web tree type-checks and all tests pass**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -E 'panes|PaneState|secondaryId|onToggleSplit|PaneResizer|highlightedPaths|onOpenFileRight|clampRatio|splitRatio' || echo "clean"`
Expected: `clean`. The 22 pre-existing errors described in the header remain and are out of scope; `ProjectDetail.tsx` will still report its `params.id` errors at shifted line numbers.

Run: `bun run test:web`
Expected: PASS — every suite, including the pre-existing ones.

- [ ] **Step 10: Commit Tasks 6 and 7 together**

```bash
git add web/src/components/InfoPane.tsx web/src/pages/ProjectDetail.tsx
git commit -m "feat(panes): pin a file to a second editor pane

Routes every tab transition through lib/panes.ts, which enforces
activeId !== secondaryId. This also fixes a latent bug in the sessions
poll, whose fallback to fileTabs[0] could make the pinned file active
in both panes at once."
```

---

### Task 8: Layout CSS

Three of the existing `.terminal-area > …` rules are direct-child selectors and break the moment views are nested inside a pane. The grid keeps the same DOM shape split or not, so splitting never remounts the left pane's views.

**Files:**
- Modify: `web/src/styles.css` (lines 107-110, and the tab-button rules near `.tab-kill`)

- [ ] **Step 1: Replace the terminal-area rules**

Replace lines 107-110 of `web/src/styles.css`:

```css
.terminal-area { position: relative; min-height: 0; min-width: 0; }
.terminal-area > .terminal-host { position: absolute; inset: 0; }
.terminal-area > .file-editor { position: absolute; inset: 0; }
.terminal-area > .session-transcript { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }
```

with:

```css
.terminal-area { display: grid; grid-template-columns: 1fr; min-height: 0; min-width: 0; }
.terminal-area.split { grid-template-columns: var(--split-left, 50%) 6px 1fr; }
.pane { position: relative; min-height: 0; min-width: 0; }
.pane > .terminal-host { position: absolute; inset: 0; }
.pane > .file-editor { position: absolute; inset: 0; }
.pane > .session-transcript { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }

.pane-resizer { background: var(--border); cursor: col-resize; }
.pane-resizer:hover { background: var(--accent); }
.pane-resizer:focus-visible { background: var(--accent); outline: none; }

/* Too narrow to compare: collapse to the left pane. secondaryId stays in state,
   so widening the window restores the split. */
@media (max-width: 900px) {
  .terminal-area.split { grid-template-columns: 1fr; }
  .terminal-area.split > .pane-resizer,
  .terminal-area.split > .pane-right { display: none; }
}
```

- [ ] **Step 2: Style the split button and the pinned tab**

Find the `.tab-kill` rule in `web/src/styles.css` and add immediately after it:

```css
.tab-split { background: transparent; border: 0; color: var(--fg-dim); cursor: pointer; font: inherit; font-size: 0.75rem; padding: 0 0.15rem; opacity: 0; }
.tab:hover .tab-split { opacity: 1; }
.tab.pinned .tab-split { opacity: 1; color: var(--accent); }
.tab.pinned { border-color: var(--accent); }
```

- [ ] **Step 3: Verify by eye**

Run: `bun run dev:server` and `bun run dev:web`, open http://localhost:5173, pick a project, open the info pane's `files` tab.

Confirm each of these:
1. Open two files. Click ◨ on the second — it moves to a right pane, the tab shows a `pinned` accent border, and the first file stays on the left.
2. Drag the divider. Both editors reflow; the ratio stops at roughly 20% / 80%.
3. Focus the divider with Tab, press ArrowLeft/ArrowRight — it moves.
4. Type in both editors. Each shows its own `●` dirty dot on its own tab. `Cmd-S` in one saves only that file.
5. Alt-click a **git-modified** file in the tree. It opens as an editor on the right, *not* as a diff.
6. Click the pinned tab in the strip — it returns to the left and the split closes.
7. Start a terminal, leave a file pinned right. The terminal reflows as you drag the divider.
8. Reload the page. The split, the pinned file, and the ratio all come back.
9. Narrow the window below 900px. The right pane hides. Widen it — the split returns.

- [ ] **Step 4: Commit**

```bash
git add web/src/styles.css
git commit -m "feat(panes): grid layout, splitter styling, narrow-screen collapse"
```

---

### Task 9: Guard against pane state leaking across projects

`ProjectDetail.tabLeak.test.tsx` exists because persisting tab state during a project switch once wrote the old project's tabs into the new project's storage key. `secondaryId` is persisted by the same mechanism and needs the same guard.

**Files:**
- Modify: `web/tests/ProjectDetail.tabLeak.test.tsx`

The file already has everything needed: a `renderApp()` helper (router + projects context), a `navigate()` escape hatch, a `tabLabels()` reader, and a `beforeEach` that clears `localStorage` and resets the API mocks. It mocks `InfoPane` and `FileEditor` to stubs, so this test exercises tab and pane state without CodeMirror. The two projects are `alpha` and `beta`. Tests are top-level `test()` calls — there is no `describe` block.

- [ ] **Step 1: Add the failing test**

Append to the end of `web/tests/ProjectDetail.tabLeak.test.tsx`:

```tsx
test("the pinned tab does not follow you when switching projects", async () => {
  // alpha has two files open, the second pinned to the right pane. beta has none.
  localStorage.setItem("forest.openFiles.alpha", JSON.stringify(["src/one.ts", "src/two.ts"]));
  localStorage.setItem("forest.activeTab.alpha", JSON.stringify("file:src/one.ts"));
  localStorage.setItem("forest.secondaryTab.alpha", JSON.stringify("file:src/two.ts"));

  const { container } = renderApp();
  navigate("/projects/alpha");
  await waitFor(() => expect(container.querySelector(".tab.pinned")).toBeTruthy());
  expect(container.querySelector(".terminal-area.split")).toBeTruthy();

  // Switch to beta — alpha's pin must not leak in, and the split must close.
  navigate("/projects/beta");
  await waitFor(() => expect(tabLabels(container)).toEqual([]));
  expect(container.querySelector(".terminal-area.split")).toBeNull();
  expect(JSON.parse(localStorage.getItem("forest.secondaryTab.beta") ?? "null")).toBeNull();

  // Returning to alpha restores the pin from alpha's own storage key.
  navigate("/projects/alpha");
  await waitFor(() => expect(container.querySelector(".tab.pinned")).toBeTruthy());
  expect(JSON.parse(localStorage.getItem("forest.secondaryTab.alpha")!)).toBe("file:src/two.ts");
});
```

- [ ] **Step 2: Run it**

Run: `cd web && bunx vitest run tests/ProjectDetail.tabLeak.test.tsx`
Expected: PASS. The `saveSecondaryTab` effect added in Task 7 already keys off `tabsProjectId` (not the reactive `params.id`), which is exactly the guard this asserts. If it FAILS, the effect is keyed off `params.id` — fix that in `ProjectDetail.tsx`, not in the test.

- [ ] **Step 3: Run the full suites**

Run: `bun run test:web`
Expected: PASS.

Run: `bun run test:server`
Expected: PASS — untouched by this plan, but confirm nothing regressed.

- [ ] **Step 4: Commit**

```bash
git add web/tests/ProjectDetail.tabLeak.test.tsx
git commit -m "test(panes): assert pinned tab does not leak across projects"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| `secondaryId` + `splitRatio` signals | 7 |
| Invariant 1 (pin names a live file tab) | 1 (`reconcilePanes`), 2 (`loadSecondaryTab`) |
| Invariant 2 (`activeId !== secondaryId`) | 1 (asserted in every test), 2, 7 (poll fix) |
| Transition: split file right | 1, 7 |
| Transition: click tab in strip | 1, 7 |
| Transition: close tab | 1, 7 |
| Degenerate case: split the only tab | 1 |
| Pure `lib/panes.ts` | 1 |
| Terminal left + file right | 1 (`activeId` unrestricted), 8 step 3.7 |
| ◨ split button, pinned marker | 4, 8 |
| Alt-click before the git branch | 5 |
| `highlightedPaths` in the tree | 5, 6, 7 |
| `PaneResizer`, pointer capture, arrow keys | 3 |
| `.pane` grid, three moved selectors | 8 |
| Narrow-screen collapse in `styles.css` | 8 |
| Validating persistence | 2 |
| Debounced/committed ratio writes | 3 (`onCommit`), 7 (step 3) |
| Project switch clears pane state | 7 (step 5) |
| Clean terminal exit skips the pin | 7 (step 6) |
| `FileEditor.tsx` unchanged | — (no task touches it) |
