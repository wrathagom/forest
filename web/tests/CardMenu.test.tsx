import { render, fireEvent, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import CardMenu from "../src/components/CardMenu";

type Props = {
  pinned: boolean; hidden: boolean;
  onOpen: () => void; onRefresh: () => void; onCopyPath: () => void;
  onTogglePin: () => void; onToggleArchive: () => void;
};

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    pinned: false, hidden: false,
    onOpen: vi.fn(), onRefresh: vi.fn(), onCopyPath: vi.fn(),
    onTogglePin: vi.fn(), onToggleArchive: vi.fn(),
    ...over,
  };
  const utils = render(() => <CardMenu {...props} />);
  const open = () =>
    fireEvent.click(utils.container.querySelector(".card-menu-trigger") as HTMLElement);
  return { ...utils, props, open };
}

// Direct children of the popover, in DOM order, with the rule collapsed to a
// marker so ordering (including its position relative to the rule) is a
// single flat array comparison.
const popoverStructure = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".card-menu-popover > *")).map((el) =>
    el.classList.contains("card-menu-rule") ? "—" : el.textContent,
  );

describe("CardMenu", () => {
  test("renders a single always-visible trigger", () => {
    const { container } = setup();
    expect(container.querySelectorAll(".card-menu-trigger")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /more/i })).toBeTruthy();
  });

  test("the menu is closed until the trigger is clicked", () => {
    const { open, queryByText, getByText } = setup();
    expect(queryByText("refresh")).toBeNull();
    open();
    expect(getByText("refresh")).toBeTruthy();
  });

  test("the trigger toggles rather than only opening", () => {
    const { open, queryByText } = setup();
    open();
    expect(queryByText("refresh")).toBeTruthy();
    open();
    expect(queryByText("refresh")).toBeNull();
  });

  test("shows pin for an unpinned project and unpin for a pinned one", () => {
    const a = setup({ pinned: false });
    a.open();
    expect(a.getByText("pin")).toBeTruthy();
    a.unmount();

    const b = setup({ pinned: true });
    b.open();
    expect(b.getByText("unpin")).toBeTruthy();
  });

  test("pin and unpin both fire onTogglePin", () => {
    // The two tests above only check the rendered label — they'd pass even
    // if pin were miswired to onToggleArchive. Assert the callback directly.
    const a = setup({ pinned: false });
    a.open();
    fireEvent.click(a.getByText("pin"));
    expect(a.props.onTogglePin).toHaveBeenCalledTimes(1);
    a.unmount();

    const b = setup({ pinned: true });
    b.open();
    fireEvent.click(b.getByText("unpin"));
    expect(b.props.onTogglePin).toHaveBeenCalledTimes(1);
  });

  test("shows restore instead of archive when hidden", () => {
    const { open, getByText, queryByText } = setup({ hidden: true });
    open();
    expect(getByText("restore")).toBeTruthy();
    expect(queryByText("archive")).toBeNull();
  });

  test("omits pin entirely for an archived project", () => {
    // Archived projects are excluded from the default view, so pinning one
    // does nothing. The card this replaces omitted it too.
    const { open, queryByText } = setup({ hidden: true, pinned: false });
    open();
    expect(queryByText("pin")).toBeNull();
    expect(queryByText("unpin")).toBeNull();
  });

  test("an item fires its callback and closes the menu", () => {
    const { props, open, getByText, queryByText } = setup();
    open();
    fireEvent.click(getByText("refresh"));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(queryByText("refresh")).toBeNull();
  });

  test("open fires onOpen", () => {
    const { props, open, getByText } = setup();
    open();
    fireEvent.click(getByText("open"));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  test("archive fires onToggleArchive", () => {
    const { props, open, getByText } = setup();
    open();
    fireEvent.click(getByText("archive"));
    expect(props.onToggleArchive).toHaveBeenCalledTimes(1);
  });

  test("copy path fires onCopyPath", () => {
    const { props, open, getByText } = setup();
    open();
    fireEvent.click(getByText("copy path"));
    expect(props.onCopyPath).toHaveBeenCalledTimes(1);
  });

  test("clicking outside closes the menu", () => {
    const { open, queryByText } = setup();
    open();
    expect(queryByText("refresh")).toBeTruthy();
    fireEvent.click(document.body);
    expect(queryByText("refresh")).toBeNull();
  });

  test("stops click propagation so the card underneath does not navigate", () => {
    const onParent = vi.fn();
    const { container } = render(() => (
      <div onclick={onParent}>
        <CardMenu
          pinned={false} hidden={false}
          onOpen={() => {}} onRefresh={() => {}} onCopyPath={() => {}}
          onTogglePin={() => {}} onToggleArchive={() => {}}
        />
      </div>
    ));
    fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement);
    expect(onParent).not.toHaveBeenCalled();
  });

  test("orders items open, refresh, copy path, a rule, pin, then archive last", () => {
    // "archive is last and separated by a rule" is a deliberate design
    // decision (a semi-destructive action earns a second step). This fails
    // if archive moves above the rule, or anywhere but last.
    const { open, container } = setup();
    open();
    expect(popoverStructure(container)).toEqual([
      "open", "refresh", "copy path", "—", "pin", "archive",
    ]);
  });

  test("when hidden, orders items without pin but still separates restore with the rule", () => {
    const { open, container } = setup({ hidden: true });
    open();
    expect(popoverStructure(container)).toEqual([
      "open", "refresh", "copy path", "—", "restore",
    ]);
  });

  test("Escape closes the menu and returns focus to the trigger", () => {
    const { open, queryByText, container } = setup();
    open();
    expect(queryByText("refresh")).toBeTruthy();
    const trigger = container.querySelector(".card-menu-trigger") as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(queryByText("refresh")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("activating an item returns focus to the trigger instead of dropping it", () => {
    // The item unmounts (it's inside the `<Show>`) the instant it's clicked,
    // which would otherwise drop focus to <body> and lose the user's place.
    const { open, getByText, container } = setup();
    open();
    fireEvent.click(getByText("refresh"));
    const trigger = container.querySelector(".card-menu-trigger");
    expect(document.activeElement).toBe(trigger);
  });

  test("removes the document click listener it registered, on unmount", () => {
    // Solid delegates click to document too, and never removes that one — so
    // assert that *a* handler added during render is later removed, rather than
    // that every click listener disappears.
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    try {
      const { unmount } = setup();
      const added = addSpy.mock.calls.filter((c) => c[0] === "click").map((c) => c[1]);
      expect(added.length).toBeGreaterThan(0);

      unmount();

      const removed = removeSpy.mock.calls.filter((c) => c[0] === "click").map((c) => c[1]);
      expect(added.some((h) => removed.includes(h))).toBe(true);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
