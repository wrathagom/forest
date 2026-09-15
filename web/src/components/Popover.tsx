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
