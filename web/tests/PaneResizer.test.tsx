import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import PaneResizer from "../src/components/PaneResizer";

function setup(ratio = 0.5, left = 0) {
  const onRatio = vi.fn();
  const onCommit = vi.fn();
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left, width: 1000, top: 0, height: 500, right: left + 1000, bottom: 500, x: left, y: 0, toJSON: () => {} }) as DOMRect;
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

  test("the ratio is measured from the container's left edge, not the viewport's", () => {
    // Without the `- rect.left` subtraction this yields 0.5, not 0.3.
    const { onRatio, el } = setup(0.5, 200);
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 });
    expect(onRatio).toHaveBeenCalledWith(0.3);
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

  test("a stray pointerup with no drag in progress does not commit", () => {
    const { onCommit, el } = setup(0.5);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("pointercancel ends the drag so the divider does not follow the bare cursor", () => {
    const { onRatio, el } = setup(0.5);
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 300 });
    expect(onRatio).toHaveBeenCalledWith(0.3);
    fireEvent.pointerCancel(el, { pointerId: 1 });
    onRatio.mockClear();
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 700 });
    expect(onRatio).not.toHaveBeenCalled();
  });

  test("aria-valuenow tracks the ratio signal", () => {
    const [ratio, setRatio] = createSignal(0.5);
    const { container: root } = render(() => (
      <PaneResizer ratio={ratio} onRatio={setRatio} onCommit={() => {}} container={() => undefined} />
    ));
    const el = root.querySelector(".pane-resizer") as HTMLElement;
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    setRatio(0.7);
    expect(el.getAttribute("aria-valuenow")).toBe("70");
  });
});
