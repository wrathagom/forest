import { Show, createSignal, onCleanup } from "solid-js";

export type CardMenuProps = {
  pinned: boolean;
  hidden: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onCopyPath: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
};

/**
 * The card's only action affordance: always visible, click to open. Not
 * hover-revealed, so touch and keyboard work without a special path.
 * Click-outside handling follows the pattern in LauncherButton.tsx.
 */
export default function CardMenu(props: CardMenuProps) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLSpanElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  // The `contains` guard is load-bearing, not defensive. Solid delegates click
  // to the document, so a click inside the menu has *already* reached document
  // by the time any handler runs — `stopPropagation()` in a child handler does
  // not un-deliver it to this native listener. Without the guard, opening the
  // menu would immediately close it again.
  const onDocClick = (e: MouseEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("click", onDocClick);
  onCleanup(() => document.removeEventListener("click", onDocClick));

  // Every click inside the menu is stopped so the card body's navigate handler
  // never fires.
  const swallow = (e: MouseEvent) => e.stopPropagation();

  const item = (label: string, run: () => void, danger = false) => (
    <button
      class={`card-menu-item${danger ? " danger" : ""}`}
      onclick={(e) => {
        e.stopPropagation();
        setOpen(false);
        run();
        // The item that was just clicked is about to unmount (it's inside the
        // `<Show>`), which would otherwise drop focus to <body>. Send it back
        // to the trigger — the place the user came from — instead.
        triggerRef?.focus();
      }}
    >
      {label}
    </button>
  );

  // Escape is the only keyboard affordance this "disclosure of buttons"
  // pattern needs beyond native <button> + Tab: without it, the only way out
  // is tabbing back to the trigger and re-toggling it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      triggerRef?.focus();
    }
  };

  return (
    <span class="card-menu" ref={rootRef} onclick={swallow} onkeydown={onKeyDown}>
      <button
        class="card-menu-trigger"
        ref={triggerRef}
        title="more"
        aria-label="more"
        aria-expanded={open()}
        onclick={(e) => {
          e.stopPropagation();
          setOpen(!open());
        }}
      >
        {/* Inline SVG rather than a ☰ glyph: no font metrics, so the icon is
            centred by the flex box alone. */}
        <svg width="11" height="9" viewBox="0 0 11 9" aria-hidden="true">
          <path
            d="M.6 1h9.8M.6 4.5h9.8M.6 8h9.8"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
      <Show when={open()}>
        <span class="card-menu-popover">
          {item("open", props.onOpen)}
          {item("refresh", props.onRefresh)}
          {item("copy path", props.onCopyPath)}
          <span class="card-menu-rule" />
          {/* No pin option for an archived project: archived projects are
              excluded from the default view, so pinning one does nothing.
              The card this replaces omitted it for the same reason. */}
          <Show when={!props.hidden}>
            {item(props.pinned ? "unpin" : "pin", props.onTogglePin)}
          </Show>
          {item(props.hidden ? "restore" : "archive", props.onToggleArchive, !props.hidden)}
        </span>
      </Show>
    </span>
  );
}
