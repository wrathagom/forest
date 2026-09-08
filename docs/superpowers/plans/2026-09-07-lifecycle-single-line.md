# Single-Line Lifecycle Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the whole `forest.yaml` lifecycle surface (top level plus every named section) on one non-wrapping line in the project detail panel, with groups that do not fit collapsing into a `☰` menu, and last-run output shown in a floating popover instead of an inline `<details>`.

**Architecture:** A generic `OverflowRow` renders the visible row plus an inert, invisible measuring copy of every item, and uses a pure `visibleCount` helper on the measured right edges to decide how many items stay inline; the rest render inside a `☰` popover. A small controlled `Popover` primitive (click-outside, Escape, focus return) backs both that menu and the per-group last-run panels. `LifecyclePanel` keeps its data, polling, and action handlers, but builds a `LifecycleGroup[]` view model and renders it through `OverflowRow`. Nothing server-side or in the API changes.

**Tech Stack:** SolidJS 1.9 + Vitest 4 + `@solidjs/testing-library` (jsdom) in `web/`. Run tests with `cd web && bunx vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-09-07-lifecycle-single-line-design.md`

**Notes for the implementer:**

- Dependencies are installed with `bun install` at the repo root (workspaces). `web/node_modules` holds the web packages.
- `docs/superpowers/` is gitignored; commit files under it with `git add -f`.
- `bunx tsc -p web/tsconfig.json --noEmit` has 29 pre-existing errors unrelated to this work. The gate for each task is: no errors mentioning the files you touched. Check with `cd web && bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'overflow|Popover|OverflowRow|LifecyclePanel|helpers/geometry'` → expect no output.
- Existing tests use lowercase Solid event props (`onclick`, `onkeydown`) and `fireEvent` from `@solidjs/testing-library`. Follow that.
- In jsdom every `offsetWidth`/`offsetLeft`/`clientWidth` is `0` and `ResizeObserver` is undefined, so unless a test stubs geometry, every item "fits" and nothing overflows.

---

## File Structure

- **Create** `web/src/lib/overflow.ts` — pure `visibleCount(rights, width, reserve)`.
- **Create** `web/src/components/Popover.tsx` — controlled disclosure primitive.
- **Create** `web/src/components/OverflowRow.tsx` — measured overflow row with `☰` menu.
- **Modify** `web/src/components/LifecyclePanel.tsx` — group view model, `LifecycleGroupView`, `LastRunButton`; renders through `OverflowRow`.
- **Modify** `web/src/styles.css` — add popover + overflow rules after the card-menu block; replace the lifecycle block.
- **Create** `web/tests/helpers/geometry.ts` — shared geometry stub for jsdom.
- **Create** `web/tests/overflow.test.ts`, `web/tests/Popover.test.tsx`, `web/tests/OverflowRow.test.tsx`.
- **Modify** `web/tests/LifecyclePanel.test.tsx` — text queries skip the measuring copy; new last-run and `☰` tests.

---

## Task 1: `visibleCount` pure helper

**Files:**
- Create: `web/src/lib/overflow.ts`
- Test: `web/tests/overflow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/tests/overflow.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { visibleCount } from "../src/lib/overflow";

describe("visibleCount", () => {
  test("no items → 0", () => {
    expect(visibleCount([], 500, 30)).toBe(0);
  });

  test("everything fits → all visible, nothing reserved for the menu", () => {
    // Last right edge lands exactly on the width: still fits.
    expect(visibleCount([100, 200, 300], 300, 30)).toBe(3);
  });

  test("partial fit reserves room for the menu", () => {
    // 4 items, width 250: not all fit. Usable = 250 - 30 = 220 → 2 items.
    expect(visibleCount([100, 200, 300, 400], 250, 30)).toBe(2);
  });

  test("an item that fits without the reserve but not with it is hidden", () => {
    // Width 300 fits 3 of 4 outright, but after reserving 30 only 2 fit.
    expect(visibleCount([100, 200, 300, 400], 300, 30)).toBe(2);
  });

  test("first item too wide → 0", () => {
    expect(visibleCount([400, 500], 250, 30)).toBe(0);
  });

  test("zero geometry (jsdom) → everything visible", () => {
    expect(visibleCount([0, 0, 0], 0, 0)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx vitest run tests/overflow.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/overflow"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/overflow.ts`:

```ts
/**
 * How many leading items fit in `width`.
 *
 * `rights[i]` is the right edge of item i when every item is laid out on one
 * unconstrained line, so it already includes any separators and gaps before
 * it. If every item fits, all are visible and no menu is needed. Otherwise
 * `reserve` (the ☰ trigger's width plus one gap) is taken off the width and
 * the count of leading items whose right edge still fits is returned — which
 * can be 0 when even the first item is too wide.
 */
export function visibleCount(rights: number[], width: number, reserve: number): number {
  if (rights.length === 0) return 0;
  if (rights[rights.length - 1] <= width) return rights.length;
  const limit = width - reserve;
  let n = 0;
  while (n < rights.length && rights[n] <= limit) n++;
  return n;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx vitest run tests/overflow.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/overflow.ts web/tests/overflow.test.ts
git commit -m "feat(web): pure visibleCount helper for measured overflow"
```

---

## Task 2: `Popover` primitive + CSS

**Files:**
- Create: `web/src/components/Popover.tsx`
- Modify: `web/src/styles.css` (insert after the `.card-menu-rule` line, currently line 185)
- Test: `web/tests/Popover.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/tests/Popover.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import Popover from "../src/components/Popover";

function setup(align?: "left" | "right") {
  const [open, setOpen] = createSignal(false);
  const utils = render(() => (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      align={align}
      panelClass="extra"
      trigger={(t) => (
        <button ref={t.ref} aria-expanded={t.expanded()} onclick={t.toggle}>trigger</button>
      )}
    >
      <button>inside</button>
    </Popover>
  ));
  const trigger = () => screen.getByRole("button", { name: "trigger" });
  return { ...utils, trigger };
}

describe("Popover", () => {
  test("closed by default; the trigger toggles and reflects aria-expanded", () => {
    const { trigger } = setup();
    expect(screen.queryByText("inside")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger());
    expect(screen.getByText("inside")).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger());
    expect(screen.queryByText("inside")).toBeNull();
  });

  test("a click inside keeps it open; a click outside closes it", () => {
    const { trigger } = setup();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("inside"));
    expect(screen.getByText("inside")).toBeTruthy();
    fireEvent.click(document.body);
    expect(screen.queryByText("inside")).toBeNull();
  });

  test("Escape closes, returns focus to the trigger, and stops propagation", () => {
    const outer = vi.fn();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <div onkeydown={outer}>
        <Popover
          open={open()}
          onOpenChange={setOpen}
          trigger={(t) => <button ref={t.ref} onclick={t.toggle}>trigger</button>}
        >
          <button>inside</button>
        </Popover>
      </div>
    ));
    const inside = screen.getByText("inside");
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(screen.queryByText("inside")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("trigger"));
    expect(outer).not.toHaveBeenCalled();
  });

  test("other keys are not swallowed", () => {
    const outer = vi.fn();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <div onkeydown={outer}>
        <Popover
          open={open()}
          onOpenChange={setOpen}
          trigger={(t) => <button ref={t.ref} onclick={t.toggle}>trigger</button>}
        >
          <button>inside</button>
        </Popover>
      </div>
    ));
    fireEvent.keyDown(screen.getByText("inside"), { key: "Enter" });
    expect(screen.getByText("inside")).toBeTruthy();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  test("aligns the panel to the requested edge and applies panelClass", () => {
    const { container, trigger } = setup("right");
    fireEvent.click(trigger());
    const panel = container.querySelector(".popover-panel") as HTMLElement;
    expect(panel.classList.contains("align-right")).toBe(true);
    expect(panel.classList.contains("extra")).toBe(true);
  });

  test("defaults to left alignment", () => {
    const { container, trigger } = setup();
    fireEvent.click(trigger());
    expect((container.querySelector(".popover-panel") as HTMLElement).classList.contains("align-left")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx vitest run tests/Popover.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/components/Popover"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/Popover.tsx`:

```tsx
import { Show, createEffect, onCleanup, type JSX } from "solid-js";

export type PopoverTrigger = {
  /** Attach to the focusable trigger element so Escape can return focus to it. */
  ref: (el: HTMLElement) => void;
  toggle: () => void;
  expanded: () => boolean;
};

export type PopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger. Attach `ref`, wire `onclick={toggle}`, set `aria-expanded={expanded()}`. */
  trigger: (t: PopoverTrigger) => JSX.Element;
  /** Which edge of the trigger the panel aligns to. Default "left". */
  align?: "left" | "right";
  /** Extra class on the panel. */
  panelClass?: string;
  /** Panel content; rendered only while open. */
  children: JSX.Element;
};

/**
 * Controlled disclosure: a trigger plus an absolutely positioned panel below
 * it. Closes on a click outside the root or on Escape (which also returns
 * focus to the trigger). Clicks inside the panel leave it open, so a menu of
 * actions stays up after one is clicked.
 */
export default function Popover(props: PopoverProps) {
  let rootRef: HTMLDivElement | undefined;
  let triggerEl: HTMLElement | undefined;

  const close = () => props.onOpenChange(false);

  // The `contains` guard is load-bearing, not defensive. Solid delegates click
  // to the document, so a click inside the panel has *already* reached
  // document by the time any handler runs — a child's stopPropagation() can't
  // un-deliver it. The listener is attached only while open.
  const onDocClick = (e: MouseEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) close();
  };
  createEffect(() => {
    if (!props.open) return;
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !props.open) return;
    // Nested popovers (a last-run panel inside the ☰ menu) close one level at
    // a time: the innermost handles Escape and stops it here.
    e.stopPropagation();
    close();
    triggerEl?.focus();
  };

  return (
    <div class="popover-root" ref={rootRef} onkeydown={onKeyDown}>
      {props.trigger({
        ref: (el) => { triggerEl = el; },
        toggle: () => props.onOpenChange(!props.open),
        expanded: () => props.open,
      })}
      <Show when={props.open}>
        <div class={`popover-panel align-${props.align ?? "left"}${props.panelClass ? ` ${props.panelClass}` : ""}`}>
          {props.children}
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx vitest run tests/Popover.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the popover CSS**

In `web/src/styles.css`, directly after this existing line:

```css
.card-menu-rule { border-top: 1px solid var(--border); margin: 0.18rem 0.1rem; }
```

insert:

```css

/* --- popover (shared disclosure: ☰ overflow menu, last-run panel) --- */
.popover-root { position: relative; display: inline-flex; }
.popover-panel {
  position: absolute; top: calc(100% + 5px); z-index: 20;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 5px;
  box-shadow: 0 8px 22px #000a;
}
.popover-panel.align-left { left: 0; }
.popover-panel.align-right { right: 0; }
```

- [ ] **Step 6: Typecheck the new file**

Run: `cd web && bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'Popover'`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Popover.tsx web/tests/Popover.test.tsx web/src/styles.css
git commit -m "feat(web): Popover primitive with click-outside and Escape handling"
```

---

## Task 3: `OverflowRow` + geometry test helper + CSS

**Files:**
- Create: `web/src/components/OverflowRow.tsx`
- Create: `web/tests/helpers/geometry.ts`
- Modify: `web/src/styles.css` (insert after the popover block added in Task 2)
- Test: `web/tests/OverflowRow.test.tsx`

- [ ] **Step 1: Write the geometry stub helper**

jsdom does no layout, so every `offsetWidth`, `offsetLeft`, and `clientWidth` is 0. This helper overrides those getters on `HTMLElement.prototype` just enough for `OverflowRow.measure()` to see real numbers: each `.overflow-item` is as wide as the `data-w` attribute of the element it wraps (or `itemWidth` when there is none), `offsetLeft` is the sum of the preceding siblings' widths (gap is 0 in jsdom), the `☰` trigger is `moreWidth` wide, and the visible row's `clientWidth` is `rowWidth`.

Create `web/tests/helpers/geometry.ts`:

```ts
/**
 * Stub jsdom's zero geometry so OverflowRow can measure. Call `restore()` in
 * afterEach. See OverflowRow.tsx `measure()` for what is read and why.
 */
export type GeometryStub = {
  setRowWidth(w: number): void;
  restore(): void;
};

export function stubGeometry(opts: { rowWidth: number; itemWidth?: number; moreWidth?: number }): GeometryStub {
  let rowWidth = opts.rowWidth;
  const itemWidth = opts.itemWidth ?? 0;
  const moreWidth = opts.moreWidth ?? 30;

  const widthOf = (el: Element | null): number => {
    if (!el) return 0;
    const src = el.querySelector<HTMLElement>("[data-w]");
    return src ? Number(src.dataset.w) : itemWidth;
  };

  const names = ["offsetWidth", "offsetLeft", "clientWidth"] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const n of names) saved.set(n, Object.getOwnPropertyDescriptor(HTMLElement.prototype, n));

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("overflow-item")) return widthOf(this);
      if (this.classList.contains("overflow-more")) return moreWidth;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("overflow-item")) return 0;
      let x = 0;
      for (let s = this.previousElementSibling; s; s = s.previousElementSibling) x += widthOf(s);
      return x;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("overflow-row") ? rowWidth : 0;
    },
  });

  return {
    setRowWidth(w) { rowWidth = w; },
    restore() {
      for (const n of names) {
        const d = saved.get(n);
        if (d) Object.defineProperty(HTMLElement.prototype, n, d);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[n];
      }
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `web/tests/OverflowRow.test.tsx`:

```tsx
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import OverflowRow from "../src/components/OverflowRow";
import { stubGeometry, type GeometryStub } from "./helpers/geometry";

// Captures every observer so a test can fire them after changing geometry.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { FakeResizeObserver.instances = FakeResizeObserver.instances.filter((i) => i !== this); }
  static fire() { for (const i of FakeResizeObserver.instances) i.cb([], i as unknown as ResizeObserver); }
}

const inlineTexts = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".overflow-row [data-place='inline']")).map((e) => e.textContent);
const menuTexts = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".overflow-menu [data-place='menu']")).map((e) => e.textContent);

function setup(items = ["a", "b", "c", "d"], menuAlert?: (hidden: string[]) => boolean) {
  const [list, setList] = createSignal(items);
  const utils = render(() => (
    <OverflowRow items={list()} separator={() => <i class="sep" />} menuAlert={menuAlert}>
      {(item, place) => <span data-w="100" data-place={place}>{item()}</span>}
    </OverflowRow>
  ));
  return { ...utils, setList };
}

describe("OverflowRow", () => {
  let geo: GeometryStub | undefined;
  beforeAll(() => vi.stubGlobal("ResizeObserver", FakeResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  afterEach(() => { geo?.restore(); geo = undefined; });

  test("with room for everything, all items are inline and there is no menu", () => {
    geo = stubGeometry({ rowWidth: 1000 });
    const { container } = setup();
    expect(inlineTexts(container)).toEqual(["a", "b", "c", "d"]);
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
    expect(container.querySelectorAll(".overflow-row .sep")).toHaveLength(3);
  });

  test("items past the width move into the ☰ menu, rendered with place=menu", () => {
    // 30px reserved for ☰ → 220 usable → two 100px items fit.
    geo = stubGeometry({ rowWidth: 250 });
    const { container } = setup();
    expect(inlineTexts(container)).toEqual(["a", "b"]);
    expect(menuTexts(container)).toEqual([]); // closed until clicked
    const more = screen.getByRole("button", { name: "more" });
    fireEvent.click(more);
    expect(menuTexts(container)).toEqual(["c", "d"]);
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  test("re-measures when the row resizes", () => {
    geo = stubGeometry({ rowWidth: 250 });
    const { container } = setup();
    expect(inlineTexts(container)).toEqual(["a", "b"]);
    geo.setRowWidth(1000);
    FakeResizeObserver.fire();
    expect(inlineTexts(container)).toEqual(["a", "b", "c", "d"]);
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
  });

  test("re-measures when the item list changes", () => {
    geo = stubGeometry({ rowWidth: 250 });
    const { container, setList } = setup(["a", "b"]);
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
    setList(["a", "b", "c"]);
    expect(inlineTexts(container)).toEqual(["a", "b"]);
    expect(screen.getByRole("button", { name: "more" })).toBeTruthy();
  });

  test("the measuring copy is inert, aria-hidden, and holds every item", () => {
    geo = stubGeometry({ rowWidth: 250 });
    const { container } = setup();
    const measure = container.querySelector(".overflow-measure") as HTMLElement;
    expect(measure.getAttribute("aria-hidden")).toBe("true");
    expect(measure.hasAttribute("inert")).toBe(true);
    expect(measure.querySelectorAll("[data-place='measure']")).toHaveLength(4);
    // Role queries never see the copy: exactly one accessible ☰ button.
    expect(screen.getAllByRole("button", { name: "more" })).toHaveLength(1);
  });

  test("menuAlert tints the ☰ trigger based on the hidden items", () => {
    geo = stubGeometry({ rowWidth: 250 });
    setup(["a", "b", "c", "d"], (hidden) => hidden.includes("d"));
    expect(screen.getByRole("button", { name: "more" }).classList.contains("alert")).toBe(true);
  });

  test("when every item fits again the menu closes and disappears, and reappears closed", () => {
    geo = stubGeometry({ rowWidth: 250 });
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    expect(menuTexts(container)).toEqual(["c", "d"]);
    geo.setRowWidth(1000);
    FakeResizeObserver.fire();
    expect(container.querySelector(".overflow-menu")).toBeNull();
    geo.setRowWidth(250);
    FakeResizeObserver.fire();
    expect(screen.getByRole("button", { name: "more" })).toBeTruthy();
    expect(container.querySelector(".overflow-menu")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && bunx vitest run tests/OverflowRow.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/components/OverflowRow"`.

- [ ] **Step 4: Write the implementation**

Create `web/src/components/OverflowRow.tsx`:

```tsx
import { Index, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import Popover from "./Popover";
import { visibleCount } from "../lib/overflow";

export type OverflowPlace = "inline" | "menu" | "measure";

export type OverflowRowProps<T> = {
  items: T[];
  /** Render one item for a placement. Called via <Index>, so `item` is an accessor. */
  children: (item: () => T, place: OverflowPlace) => JSX.Element;
  /** Rendered before every item except the first, inline and in the measuring copy. */
  separator?: () => JSX.Element;
  /** aria-label / title for the ☰ trigger. Default "more". */
  menuLabel?: string;
  /** When true the ☰ trigger gets the `alert` class. Receives the hidden items. */
  menuAlert?: (hidden: T[]) => boolean;
};

const MoreIcon = () => (
  // Inline SVG rather than a ☰ glyph: no font metrics, so the icon is centred
  // by the flex box alone (same as CardMenu).
  <svg width="11" height="9" viewBox="0 0 11 9" aria-hidden="true">
    <path d="M.6 1h9.8M.6 4.5h9.8M.6 8h9.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
  </svg>
);

/**
 * A single non-wrapping row. Items that do not fit the row's width collapse,
 * from the right, into a ☰ popover.
 *
 * How it measures: an inert, invisible copy of every item is always rendered
 * in `.overflow-strip` at its natural width. `measure()` reads each copy's
 * right edge and the visible row's width, and `visibleCount` decides how many
 * leading items stay inline (reserving room for ☰ only when something is
 * hidden). The visible row is never clipped, so popovers inside it position
 * normally. In jsdom all geometry is 0, so everything fits.
 */
export default function OverflowRow<T>(props: OverflowRowProps<T>) {
  let rowRef: HTMLDivElement | undefined;
  let stripRef: HTMLDivElement | undefined;
  let moreCloneRef: HTMLButtonElement | undefined;
  // null = not measured yet → show everything.
  const [count, setCount] = createSignal<number | null>(null);
  const [menuOpen, setMenuOpen] = createSignal(false);

  const measure = () => {
    if (!rowRef || !stripRef) return;
    const copies = Array.from(stripRef.children).filter((el) => el.classList.contains("overflow-item")) as HTMLElement[];
    const rights = copies.map((el) => el.offsetLeft + el.offsetWidth);
    const gap = parseFloat(getComputedStyle(rowRef).columnGap) || 0;
    const reserve = (moreCloneRef?.offsetWidth ?? 0) + gap;
    setCount(visibleCount(rights, rowRef.clientWidth, reserve));
  };

  onMount(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    if (rowRef) ro.observe(rowRef);     // container width
    if (stripRef) ro.observe(stripRef); // content width (chip text, buttons appearing)
    onCleanup(() => ro.disconnect());
  });
  // Items added or removed re-measure even without a ResizeObserver.
  createEffect(on(() => props.items.length, () => measure(), { defer: true }));

  const visible = createMemo(() => (count() === null ? props.items : props.items.slice(0, count()!)));
  const hidden = createMemo(() => (count() === null ? [] : props.items.slice(count()!)));
  // The ☰ popover unmounts when nothing is hidden; don't let it come back open.
  createEffect(() => { if (hidden().length === 0) setMenuOpen(false); });

  const label = () => props.menuLabel ?? "more";

  return (
    <div class="overflow-root">
      <div class="overflow-row" ref={rowRef}>
        <Index each={visible()}>
          {(item, i) => (
            <div class="overflow-item">
              <Show when={i > 0}>{props.separator?.()}</Show>
              {props.children(item, "inline")}
            </div>
          )}
        </Index>
        <Show when={hidden().length > 0}>
          <Popover
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            align="right"
            panelClass="overflow-menu"
            trigger={(t) => (
              <button
                type="button"
                class={`overflow-more${props.menuAlert?.(hidden()) ? " alert" : ""}`}
                ref={t.ref}
                title={label()}
                aria-label={label()}
                aria-expanded={t.expanded()}
                onclick={t.toggle}
              >
                <MoreIcon />
              </button>
            )}
          >
            <Index each={hidden()}>
              {(item) => <div class="overflow-menu-item">{props.children(item, "menu")}</div>}
            </Index>
          </Popover>
        </Show>
      </div>
      <div class="overflow-measure" aria-hidden="true" inert>
        <div class="overflow-strip" ref={stripRef}>
          <Index each={props.items}>
            {(item, i) => (
              <div class="overflow-item">
                <Show when={i > 0}>{props.separator?.()}</Show>
                {props.children(item, "measure")}
              </div>
            )}
          </Index>
          <button type="button" class="overflow-more" tabindex="-1" ref={moreCloneRef}><MoreIcon /></button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && bunx vitest run tests/OverflowRow.test.tsx`
Expected: PASS, 7 tests.

If "the measuring copy is inert" fails on `hasAttribute("inert")`, Solid rendered the boolean differently; change the attribute in the JSX to `attr:inert=""` and re-run.

- [ ] **Step 6: Add the overflow CSS**

In `web/src/styles.css`, directly after the popover block added in Task 2 (the line `.popover-panel.align-right { right: 0; }`), insert:

```css

/* --- overflow row (single line; extras collapse into ☰) --- */
.overflow-root { position: relative; }
.overflow-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.5rem; min-width: 0; }
.overflow-row > * { flex: 0 0 auto; }
.overflow-row > .popover-root { margin-left: auto; }
.overflow-item { display: inline-flex; align-items: center; gap: 0.5rem; }
.overflow-more {
  width: var(--icon-btn); height: var(--icon-btn); box-sizing: border-box;
  padding: 0; flex: 0 0 auto; cursor: pointer; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fg-dim); background: color-mix(in srgb, currentColor 10%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}
.overflow-more:hover { background: color-mix(in srgb, currentColor 24%, transparent); color: var(--fg); }
.overflow-more.alert { color: var(--error); }
.overflow-more svg { display: block; }
/* Invisible measuring copy. 0×0 + overflow hidden so its natural (possibly
   very wide) content adds no scrollable overflow to the page; the strip inside
   keeps its max-content width so offsets are the unconstrained values. */
.overflow-measure {
  position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: hidden;
  visibility: hidden; pointer-events: none;
}
.overflow-strip { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.5rem; width: max-content; }
.overflow-strip > * { flex: 0 0 auto; }
.overflow-menu { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem; min-width: 12rem; }
.overflow-menu-item + .overflow-menu-item { border-top: 1px solid var(--border); padding-top: 0.4rem; }
```

- [ ] **Step 7: Typecheck the new files**

Run: `cd web && bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'OverflowRow|helpers/geometry'`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/OverflowRow.tsx web/tests/OverflowRow.test.tsx web/tests/helpers/geometry.ts web/src/styles.css
git commit -m "feat(web): OverflowRow — single line with measured overflow into a ☰ menu"
```

---

## Task 4: Rewrite `LifecyclePanel` onto `OverflowRow`

**Files:**
- Modify: `web/src/components/LifecyclePanel.tsx` (full rewrite)
- Modify: `web/src/styles.css` (replace the lifecycle block, currently `.lifecycle-panel {` through `.lifecycle-section-name ...`, lines 297–328)
- Test: `web/tests/LifecyclePanel.test.tsx`

- [ ] **Step 1: Make text queries skip the measuring copy**

The panel will render an inert, `aria-hidden` copy of every group. Role queries skip it automatically, but `getByText` does not, so `findByText("game")` would find two elements. Configure text queries to ignore anything under `aria-hidden`.

In `web/tests/LifecyclePanel.test.tsx`, change the second import line and add the `configure` call right after the imports:

```ts
import { render, screen, waitFor, fireEvent, configure } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import LifecyclePanel from "../src/components/LifecyclePanel";
import * as api from "../src/api";
import { stubGeometry } from "./helpers/geometry";

// The panel renders an inert, aria-hidden measuring copy of every group (see
// OverflowRow). Role queries already skip it; make text queries skip it too so
// findByText("game") matches the one visible element.
configure({ defaultIgnore: "script, style, [aria-hidden='true'] *" });
```

- [ ] **Step 2: Add the failing tests**

Append inside the `describe("LifecyclePanel", …)` block, after the last existing test:

```tsx
  test("a group with a last run renders a 'last run' button that opens the output in a popover", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running",
      lastRun: { kind: "start", exitCode: 0, output: "TOP-OUTPUT", at: 1, failed: false },
    });
    render(() => <LifecyclePanel projectId="p" />);
    const btn = await screen.findByRole("button", { name: /lifecycle last run/i });
    expect(screen.queryByText("TOP-OUTPUT")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByText("TOP-OUTPUT")).toBeTruthy();
    expect(btn.classList.contains("failed")).toBe(false);
  });

  test("a failed run arriving after Start auto-opens the popover and tints the trigger", async () => {
    const base = { hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped" as const };
    vi.spyOn(api, "fetchLifecycle")
      .mockResolvedValueOnce({ ...base, lastRun: null })
      .mockResolvedValue({ ...base, lastRun: { kind: "start", exitCode: 1, output: "BOOM", at: 2, failed: true } });
    vi.spyOn(api, "startLifecycle").mockResolvedValue({ exitCode: 1, output: "BOOM", timedOut: false, failed: true });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByText("BOOM")).toBeTruthy();
    expect(screen.getByRole("button", { name: /lifecycle last run/i }).classList.contains("failed")).toBe(true);
  });

  test("a stale failed last run on first load tints the trigger but does not open the popover", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "stopped",
      lastRun: { kind: "start", exitCode: 1, output: "OLD-BOOM", at: 5, failed: true },
    });
    render(() => <LifecyclePanel projectId="p" />);
    const btn = await screen.findByRole("button", { name: /lifecycle last run/i });
    expect(btn.classList.contains("failed")).toBe(true);
    expect(screen.queryByText("OLD-BOOM")).toBeNull();
  });

  test("a section's last run opens its own popover with only that section's output", async () => {
    vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
      hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
      sections: [
        { name: "game", config: { start: "godot ." }, status: "none", lastRun: { kind: "start", exitCode: 0, output: "GAME-OUTPUT", at: 3, failed: false } },
      ],
    });
    render(() => <LifecyclePanel projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: /game last run/i }));
    expect(await screen.findByText("GAME-OUTPUT")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /lifecycle last run/i })).toBeNull();
  });

  test("groups that do not fit go into the ☰ menu, which is tinted when a hidden run failed", async () => {
    // Two 100px groups in a 150px row: only the top level stays inline.
    const geo = stubGeometry({ rowWidth: 150, itemWidth: 100 });
    try {
      vi.spyOn(api, "fetchLifecycle").mockResolvedValue({
        hasConfig: true, enabled: true, config: { start: "make up" }, status: "running", lastRun: null,
        sections: [
          { name: "game", config: { start: "godot ." }, status: "none", lastRun: { kind: "start", exitCode: 1, output: "BOOM", at: 3, failed: true } },
        ],
      });
      render(() => <LifecyclePanel projectId="p" />);
      const more = await screen.findByRole("button", { name: /more/i });
      expect(more.classList.contains("alert")).toBe(true);
      expect(screen.queryByRole("button", { name: /start game/i })).toBeNull();
      fireEvent.click(more);
      expect(await screen.findByRole("button", { name: /start game/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /game last run/i }).classList.contains("failed")).toBe(true);
    } finally {
      geo.restore();
    }
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `cd web && bunx vitest run tests/LifecyclePanel.test.tsx`
Expected: the 5 new tests FAIL (no `last run` button / no `more` button); the 18 existing tests still PASS.

- [ ] **Step 4: Rewrite the component**

Replace the entire contents of `web/src/components/LifecyclePanel.tsx` with:

```tsx
import { Show, createResource, createSignal, createMemo, createEffect, on, onCleanup } from "solid-js";
import { fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle, startSection, stopSection } from "../api";
import type { LifecycleStatus, LifecycleRunResult, LifecycleView } from "../api";
import { lifecycleTone, isLifecycleUp } from "../lib/dashboard-view";
import OverflowRow, { type OverflowPlace } from "./OverflowRow";
import Popover from "./Popover";

const POLL_FAST_MS = 1_000;
const POLL_SLOW_MS = 10_000;

export type LifecycleLastRun = {
  output: string;
  failed: boolean;
  at: number;
  /** True when this run was already present when the project's view first loaded. */
  stale: boolean;
};

/** One unit on the lifecycle line: the top level (key "") or a named section. */
export type LifecycleGroup = {
  key: string;
  name: string | null;
  status: LifecycleStatus;
  showChip: boolean;
  url?: string;
  showLink: boolean;
  canStart: boolean;
  canStop: boolean;
  onStart: () => void;
  onStop: () => void;
  lastRun: LifecycleLastRun | null;
  /** Top level only: what to show instead of controls when not enabled. */
  gate?: "no-config" | "enable";
  onEnable?: () => void;
};

/** Last-run timestamps per group key, used to tell a stale failure from a new one. */
function runStamps(v: LifecycleView): Record<string, number> {
  const out: Record<string, number> = {};
  if (v.lastRun) out[""] = v.lastRun.at;
  for (const s of v.sections ?? []) if (s.lastRun) out[s.name] = s.lastRun.at;
  return out;
}

function toLastRun(
  run: { output: string; failed: boolean; at: number } | null,
  baseline: number | undefined,
): LifecycleLastRun | null {
  if (!run || !run.output) return null;
  return { output: run.output, failed: run.failed, at: run.at, stale: baseline === run.at };
}

export default function LifecyclePanel(props: { projectId: string }) {
  // Snapshot of each project's last-run timestamps from its first fetch. A
  // failed run auto-opens its popover only when it is newer than this — a
  // stale failure from an earlier visit just tints the trigger.
  const baselines = new Map<string, Record<string, number>>();
  const [data, { refetch }] = createResource(() => props.projectId, async (id) => {
    const v = await fetchLifecycle(id);
    if (!baselines.has(id)) baselines.set(id, runStamps(v));
    return v;
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Optimistic status shown the instant a command is clicked, before the first
  // poll observes the server's transient state. Cleared when the command ends.
  const [pending, setPending] = createSignal<LifecycleStatus | null>(null);
  // Per-section optimistic status, keyed by section name.
  const [sectionPending, setSectionPending] = createSignal<Record<string, LifecycleStatus>>({});

  // Reset per-project local state when navigating between projects so a banner
  // from one project can't bleed into the next.
  createEffect((prev: string | undefined) => {
    const id = props.projectId;
    if (prev !== undefined && prev !== id) {
      setError(null);
      setPending(null);
      setSectionPending({});
    }
    return id;
  });

  const displayStatus = (): LifecycleStatus | undefined => pending() ?? data()?.status;
  const isTransient = (s: LifecycleStatus | undefined) => s === "starting" || s === "stopping";

  // Poll the (cheap) lifecycle endpoint so status updates live without a manual
  // refresh: fast while a command is in flight or the status is transient, slow
  // otherwise. Skip entirely for a project with no forest.yaml — its lifecycle
  // status can't change through Forest. Both gates are memos so the interval is
  // recreated only when the cadence (or the should-poll gate) flips, not on
  // every poll.
  const shouldPoll = createMemo(() => busy() || !!data()?.hasConfig);
  const anySectionTransient = createMemo(() => {
    const secs = data()?.sections ?? [];
    const pend = sectionPending();
    return secs.some((s) => isTransient(pend[s.name] ?? s.status));
  });
  const fast = createMemo(() => busy() || isTransient(displayStatus()) || anySectionTransient());
  createEffect(() => {
    if (!shouldPoll()) return;
    const ms = fast() ? POLL_FAST_MS : POLL_SLOW_MS;
    const t = setInterval(() => void refetch(), ms);
    onCleanup(() => clearInterval(t));
  });

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await setLifecycleEnabled(props.projectId, true);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Last-run output is not kept locally: `refetch()` right after the run
  // brings the server's record, which is the single source for every group.
  const run = async (kind: "start" | "stop", fn: (id: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setPending(kind === "start" ? "starting" : "stopping");
    try {
      await fn(props.projectId);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const runSection = async (name: string, kind: "start" | "stop", fn: (id: string, section: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setSectionPending((p) => ({ ...p, [name]: kind === "start" ? "starting" : "stopping" }));
    try {
      await fn(props.projectId, name);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionPending((p) => { const { [name]: _drop, ...rest } = p; return rest; });
      setBusy(false);
    }
  };

  const groups = createMemo<LifecycleGroup[]>(() => {
    const d = data();
    if (!d) return [];
    const base = baselines.get(props.projectId) ?? {};
    const topStatus = pending() ?? d.status;
    const top: LifecycleGroup = {
      key: "",
      name: null,
      status: topStatus,
      showChip: true,
      url: d.config?.url,
      showLink: !!d.config?.url && isLifecycleUp(topStatus),
      canStart: d.enabled && !!d.config?.start,
      canStop: d.enabled && !!d.config?.stop,
      onStart: () => void run("start", startLifecycle),
      onStop: () => void run("stop", stopLifecycle),
      lastRun: toLastRun(d.lastRun, base[""]),
      gate: !d.hasConfig ? "no-config" : !d.enabled ? "enable" : undefined,
      onEnable: () => void enable(),
    };
    if (!d.enabled) return [top];
    const pend = sectionPending();
    const sections = (d.sections ?? []).map((s): LifecycleGroup => {
      const status = pend[s.name] ?? s.status;
      return {
        key: s.name,
        name: s.name,
        status,
        showChip: status !== "none",
        url: s.config.url,
        // A health section links only while up; a launcher (no health) has no
        // up signal, so its link is a plain convenience whenever a url exists.
        showLink: !!s.config.url && (s.config.health ? isLifecycleUp(status) : true),
        canStart: !!s.config.start,
        canStop: !!s.config.stop,
        onStart: () => void runSection(s.name, "start", startSection),
        onStop: () => void runSection(s.name, "stop", stopSection),
        lastRun: toLastRun(s.lastRun, base[s.name]),
      };
    });
    return [top, ...sections];
  });

  return (
    <div class="lifecycle-panel">
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <Show when={data.error}>
        <div class="banner banner-error">{(data.error as Error).message}</div>
      </Show>
      <Show when={data.loading && !data()}>
        <span class="muted">lifecycle…</span>
      </Show>
      <Show when={data()}>
        {/* Keyed on the project id so per-group UI state (open popovers) resets
            on navigation, while polls of the same project keep it. */}
        <Show when={props.projectId} keyed>
          {() => (
            <OverflowRow
              items={groups()}
              separator={() => <span class="lifecycle-sep" />}
              menuLabel="more lifecycle controls"
              menuAlert={(hidden) => hidden.some((g) => g.lastRun?.failed === true)}
            >
              {(group, place) => <LifecycleGroupView group={group()} place={place} busy={busy()} />}
            </OverflowRow>
          )}
        </Show>
      </Show>
    </div>
  );
}

function LifecycleGroupView(props: { group: LifecycleGroup; place: OverflowPlace; busy: boolean }) {
  const g = () => props.group;
  const label = () => g().name ?? "lifecycle";
  const chipTitle = () => (g().name ? `${g().name} lifecycle` : "forest.yaml lifecycle");
  const controls = (
    <>
      <Show when={g().showChip}>
        <span class={`chip chip-${lifecycleTone(g().status)}`} title={chipTitle()}>{g().status}</span>
      </Show>
      <Show when={g().gate === "no-config"}>
        <span class="muted">No <code>forest.yaml</code> — add one with <code>start</code>/<code>stop</code>/<code>health</code> to enable lifecycle controls.</span>
      </Show>
      <Show when={g().gate === "enable"}>
        <button class="lifecycle-btn" disabled={props.busy} onclick={() => g().onEnable?.()}>Enable lifecycle</button>
      </Show>
      <Show when={g().showLink}>
        <a class="lifecycle-link" href={g().url} target="_blank" rel="noopener noreferrer">Open ↗</a>
      </Show>
      <Show when={g().canStart}>
        <button class="lifecycle-btn" disabled={props.busy} aria-label={g().name ? `Start ${g().name}` : undefined} onclick={() => g().onStart()}>Start</button>
      </Show>
      <Show when={g().canStop}>
        <button class="lifecycle-btn" disabled={props.busy} aria-label={g().name ? `Stop ${g().name}` : undefined} onclick={() => g().onStop()}>Stop</button>
      </Show>
      <Show when={g().lastRun}>
        {(lr) => <LastRunButton lastRun={lr()} label={label()} interactive={props.place !== "measure"} />}
      </Show>
    </>
  );
  const name = (
    <Show when={g().name}>
      <span class="lifecycle-section-name">{g().name}</span>
    </Show>
  );
  // `place` is fixed for the life of an instance, so a plain ternary (not a
  // reactive <Show>) picks the layout once.
  return props.place === "menu" ? (
    <div class="lifecycle-group menu">
      {name}
      <div class="lifecycle-group-controls">{controls}</div>
    </div>
  ) : (
    <div class="lifecycle-group">
      {name}
      {controls}
    </div>
  );
}

function LastRunButton(props: { lastRun: LifecycleLastRun; label: string; interactive: boolean }) {
  const cls = () => `lifecycle-lastrun${props.lastRun.failed ? " failed" : ""}`;
  // The measuring copy only needs the trigger's size — no popover, no effects.
  if (!props.interactive) {
    return <button type="button" class={cls()} tabindex="-1">last run</button>;
  }
  const [open, setOpen] = createSignal(false);
  // Auto-open when a new failed run lands. `on` fires on every poll (the
  // resource is a fresh object each time), so compare the timestamp to avoid
  // re-opening a popover the user already dismissed. A run that was already
  // there when the project loaded (`stale`) only tints the trigger.
  createEffect(on(() => props.lastRun.at, (at, prev) => {
    if (at !== prev && props.lastRun.failed && !props.lastRun.stale) setOpen(true);
  }));
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      panelClass="lifecycle-lastrun-panel"
      trigger={(t) => (
        <button
          type="button"
          class={cls()}
          ref={t.ref}
          aria-label={`${props.label} last run`}
          aria-expanded={t.expanded()}
          onclick={t.toggle}
        >
          last run
        </button>
      )}
    >
      <pre>{props.lastRun.output}</pre>
    </Popover>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bunx vitest run tests/LifecyclePanel.test.tsx`
Expected: PASS, 23 tests.

If "renders a section row…" fails with "Found multiple elements with the text: game", the `configure({ defaultIgnore })` call from Step 1 is missing or placed after a query; it must run at module load.

- [ ] **Step 6: Replace the lifecycle CSS**

In `web/src/styles.css`, replace the whole block starting at `.lifecycle-panel {` and ending with the `.lifecycle-section-name { … }` line (it sits between the `.detail-topbar { display: block; }` line and `.tab-strip { … }`) with:

```css
.lifecycle-panel { padding: 0.5rem 1.2rem; border-bottom: 1px solid var(--border); }
/* Transient error banners sit above the single control line, edge to edge. */
.lifecycle-panel > .banner { margin: -0.5rem -1.2rem 0.5rem; }
.lifecycle-btn {
  font: inherit; font-size: 0.8rem; cursor: pointer; border-radius: 3px;
  padding: 0.25rem 0.7rem; background: var(--bg-2); border: 1px solid var(--border); color: var(--fg);
}
.lifecycle-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.lifecycle-btn:disabled { opacity: 0.5; cursor: default; }
.lifecycle-link {
  font-size: 0.8rem; text-decoration: none; border-radius: 3px; padding: 0.25rem 0.7rem;
  color: var(--ok);
  border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent);
  background: color-mix(in srgb, var(--ok) 8%, transparent);
}
.lifecycle-link:hover { text-decoration: underline; }
.lifecycle-group { display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; }
.lifecycle-group.menu { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; }
.lifecycle-group-controls { display: inline-flex; align-items: center; gap: 0.4rem; }
.lifecycle-section-name { font-weight: 600; font-size: 0.85em; color: var(--fg); }
.lifecycle-sep { width: 1px; height: 1.1rem; background: var(--border); }
.lifecycle-lastrun {
  font: inherit; font-size: 0.8rem; color: var(--fg-dim); cursor: pointer;
  background: none; border: 0; border-bottom: 1px dotted currentColor;
  padding: 0.25rem 0.2rem; line-height: 1;
}
.lifecycle-lastrun:hover { color: var(--fg); }
.lifecycle-lastrun.failed { color: var(--error); }
.lifecycle-lastrun-panel { min-width: 20rem; max-width: min(40rem, 90vw); padding: 0.4rem; }
.lifecycle-lastrun-panel pre {
  margin: 0; padding: 0.5rem; max-height: 12rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
  font-size: 0.75rem; white-space: pre-wrap; word-break: break-word;
}
```

Confirm the old selectors are gone:

Run: `grep -n 'lifecycle-sections\|lifecycle-section {\|lifecycle-output' web/src/styles.css`
Expected: no output.

- [ ] **Step 7: Typecheck and run the whole web suite**

Run: `cd web && bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'LifecyclePanel|OverflowRow|Popover|overflow|helpers/geometry'`
Expected: no output.

Run: `cd web && bun run test`
Expected: all files pass. Baseline before this work was 71 files / 854 passed, 1 skipped; expect 74 files and 854 + 6 + 6 + 7 + 5 = 878 passed, 1 skipped.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/LifecyclePanel.tsx web/tests/LifecyclePanel.test.tsx web/src/styles.css
git commit -m "feat(web): single-line lifecycle panel with ☰ overflow and last-run popovers"
```

---

## Task 5: Verify in a real browser

jsdom cannot exercise layout, so the measuring path needs one look in a browser. Use the Playwright MCP tools if available (`browser_navigate`, `browser_resize`, `browser_take_screenshot`); otherwise do it by hand.

**Files:** none modified (unless a visual defect is found — fix it in the file it belongs to, add or adjust a test if behaviour changed, and commit).

- [ ] **Step 1: Give a scanned project a `forest.yaml` with sections**

Pick any project Forest already lists (open `http://localhost:5173` after Step 2 to see the list, or reuse one you know). Create `forest.yaml` in that project's root:

```yaml
start: sleep 1
stop: sleep 1
url: http://localhost:3000
sections:
  game:
    start: sleep 1
    stop: sleep 1
    url: http://localhost:8060
    health: "true"
  editor:
    start: sleep 1
  docs:
    start: sleep 1
    stop: sleep 1
    health: "false"
```

Do not commit that file into that project; delete it in Step 5.

- [ ] **Step 2: Start the dev servers**

From the repo root, in two terminals (or backgrounded):

```bash
bun run dev:server   # http://localhost:52810
bun run dev:web      # http://localhost:5173
```

- [ ] **Step 3: Check the wide layout**

Open `http://localhost:5173`, click the project from Step 1, click **Enable lifecycle** if shown. Confirm:

- Everything is on one line: chip, Start, Stop, then `│ game [healthy] Open ↗ Start Stop`, `│ editor Start`, `│ docs [stopped] Start Stop`.
- No `☰` button is visible.
- Click **Start** on `game`: the chip flips to `starting`, then a `last run` button appears; click it and a popover shows the (empty) output. Click elsewhere: it closes.

- [ ] **Step 4: Check overflow**

Narrow the window (or `browser_resize` to ~700px wide, then ~450px). Confirm:

- Groups drop off the right one at a time into a `☰` at the row's right edge; the row never wraps and the page has no horizontal scrollbar.
- Clicking `☰` lists the hidden groups vertically with their name above their controls; Start/Stop inside it work and the menu stays open.
- Widening the window brings groups back inline and removes `☰` when nothing is hidden.
- Edit `forest.yaml` so `docs.start` is `exit 1`, run Start on `docs` while it is inside `☰`: `☰` turns red; opening it shows a red `last run` trigger whose popover holds the failure output.

- [ ] **Step 5: Clean up**

Delete the temporary `forest.yaml` from the project used in Step 1 and stop the dev servers.

- [ ] **Step 6: Final full run and commit any fixes**

```bash
cd web && bun run test
```

Expected: all green. If Steps 3–4 required code changes, commit them:

```bash
git add -A web/src web/tests
git commit -m "fix(web): <what the browser check turned up>"
```

---

## Self-review against the spec

- **One row, measured overflow, ☰ pinned right, resize live** → Task 3 (`OverflowRow`, CSS `margin-left: auto`, ResizeObserver) + Task 5 browser check.
- **Group contents and order, gates, sections only when enabled, separators** → Task 4 `groups()` memo + `LifecycleGroupView`.
- **Banners stay above the row** → Task 4 JSX + `.lifecycle-panel > .banner` CSS.
- **Last-run source of truth; local `output` signal removed** → Task 4 `run()` + `toLastRun`.
- **`visibleCount` rules** → Task 1.
- **`Popover` behaviour (click-outside, Escape + focus + stopPropagation, inside clicks keep open, aria-expanded)** → Task 2.
- **`OverflowRow` DOM, measurement, RO wiring, jsdom fallback, 0×0 clipped measuring copy, alert class** → Task 3.
- **`LastRunButton`: popover, failed tint, auto-open only for new failures, non-interactive in measure copy, ☰ alert for hidden failures** → Task 4.
- **CSS removals/additions** → Tasks 2, 3, 4.
- **Superseded note in the older spec** → already committed with the spec (`f15c9f6`).
- **Tests listed in the spec** → Tasks 1–4 (`overflow`, `Popover`, `OverflowRow`, `LifecyclePanel` additions).
