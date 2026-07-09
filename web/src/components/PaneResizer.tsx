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
    e.currentTarget.focus();
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
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // pointer may already be released (e.g. pointercancel) — ignore
    }
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
      onpointercancel={onPointerUp}
      onkeydown={onKeyDown}
    />
  );
}
