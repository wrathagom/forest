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
