import { createSignal, createEffect } from "solid-js";
import { stepZoom, clampPan, ZOOM_MIN } from "../lib/imageZoom";

export default function ImageViewer(props: {
  src: string;
  alt: string;
}) {
  let container!: HTMLDivElement;
  let img!: HTMLImageElement;

  const [zoom, setZoom] = createSignal(ZOOM_MIN);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [dragging, setDragging] = createSignal(false);

  // Reset zoom/pan whenever the image changes.
  createEffect(() => {
    props.src;
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  });

  const baseSize = () => ({ w: img?.offsetWidth ?? 0, h: img?.offsetHeight ?? 0 });
  const viewSize = () => ({ w: container?.clientWidth ?? 0, h: container?.clientHeight ?? 0 });

  const applyZoom = (dir: 1 | -1) => {
    const next = stepZoom(zoom(), dir);
    setZoom(next);
    setPan((p) => clampPan(p, baseSize(), viewSize(), next));
  };

  const reset = () => {
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  };

  const atFit = () => zoom() <= ZOOM_MIN && pan().x === 0 && pan().y === 0;

  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };
  const onPointerDown = (e: PointerEvent) => {
    if (zoom() <= ZOOM_MIN) return;
    e.preventDefault();
    setDragging(true);
    dragStart = { x: e.clientX, y: e.clientY, panX: pan().x, panY: pan().y };
    img.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    const nx = dragStart.panX + (e.clientX - dragStart.x);
    const ny = dragStart.panY + (e.clientY - dragStart.y);
    setPan(clampPan({ x: nx, y: ny }, baseSize(), viewSize(), zoom()));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging()) return;
    setDragging(false);
    try {
      img.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may already be released — ignore
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      applyZoom(1);
    } else if (e.key === "-") {
      e.preventDefault();
      applyZoom(-1);
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
    }
  };

  return (
    <div ref={container!} class="file-editor-image" tabindex={0} onkeydown={onKeyDown}>
      <img
        ref={img!}
        src={props.src}
        alt={props.alt}
        draggable={false}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        style={{
          "max-width": "100%",
          "max-height": "100%",
          "object-fit": "contain",
          display: "block",
          transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
          "transform-origin": "center center",
          cursor: zoom() > ZOOM_MIN ? (dragging() ? "grabbing" : "grab") : "default",
        }}
      />
      <div class="image-zoom-controls">
        <button
          class="editor-status-toggle"
          aria-label="zoom out"
          disabled={zoom() <= ZOOM_MIN}
          onclick={() => applyZoom(-1)}
        >
          −
        </button>
        <span class="image-zoom-readout">{Math.round(zoom() * 100)}%</span>
        <button class="editor-status-toggle" aria-label="zoom in" onclick={() => applyZoom(1)}>
          +
        </button>
        <button class="editor-status-toggle" disabled={atFit()} onclick={reset}>
          fit
        </button>
      </div>
    </div>
  );
}
