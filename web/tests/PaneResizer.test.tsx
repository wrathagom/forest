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
