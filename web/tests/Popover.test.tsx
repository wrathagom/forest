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
