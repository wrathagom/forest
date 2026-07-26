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

  test("opening the menu does not leave a document listener behind on unmount", () => {
    const { open, unmount } = setup();
    open();
    unmount();
    // If onCleanup did not remove the listener this would throw on a stale ref.
    expect(() => fireEvent.click(document.body)).not.toThrow();
  });
});
