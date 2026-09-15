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
