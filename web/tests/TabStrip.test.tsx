import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import TabStrip from "../src/components/TabStrip";
import type { Tab } from "../src/lib/tabs";
import type { LauncherEntry } from "../src/components/LauncherButton";

const termTab: Tab = { kind: "terminal", id: "term:1", sessionId: "1", label: "term 1", agent: null };
const agentTermTab: Tab = { kind: "terminal", id: "term:2", sessionId: "2", label: "term 2", agent: "claude" };
const fileTab: Tab = { kind: "file", id: "file:src/x.ts", path: "src/x.ts", label: "x.ts", dirty: false };
const dirtyTab: Tab = { kind: "file", id: "file:src/y.ts", path: "src/y.ts", label: "y.ts", dirty: true };

const shellLauncher: LauncherEntry = { id: "shell", label: "Shell", command: null, args: [] };
const claudeLauncher: LauncherEntry = { id: "claude", label: "Claude", command: "claude", args: [], agent: "claude" };
const defaultLaunchers: LauncherEntry[] = [shellLauncher, claudeLauncher];

const defaultLauncherProps = {
  onLaunch: () => {},
  launchers: defaultLaunchers,
  lastUsedLauncher: "shell",
  onChangeLastUsedLauncher: () => {},
};

describe("TabStrip", () => {
  test("renders both tab kinds", () => {
    render(() => (
      <TabStrip tabs={[termTab, fileTab]} activeId="term:1" onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(screen.getByText("term 1")).toBeTruthy();
    expect(screen.getByText("x.ts")).toBeTruthy();
  });

  test("dirty file tab shows leading dot", () => {
    render(() => (
      <TabStrip tabs={[dirtyTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(screen.getByText("● y.ts")).toBeTruthy();
  });

  test("active tab gets active class", () => {
    const { container } = render(() => (
      <TabStrip tabs={[termTab, fileTab]} activeId="file:src/x.ts" onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    const active = container.querySelector(".tab.active");
    expect(active?.textContent).toContain("x.ts");
  });

  test("close on terminal tab calls onClose without confirm", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <TabStrip tabs={[termTab]} activeId={null} onSelect={() => {}} onClose={onClose} {...defaultLauncherProps} />
    ));
    const kill = container.querySelector(".tab-kill")!;
    fireEvent.click(kill);
    expect(onClose).toHaveBeenCalledWith("term:1");
  });

  test("close on dirty file tab calls confirm; cancel skips onClose", () => {
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(() => (
      <TabStrip tabs={[dirtyTab]} activeId={null} onSelect={() => {}} onClose={onClose} {...defaultLauncherProps} />
    ));
    fireEvent.click(container.querySelector(".tab-kill")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("close on dirty file tab calls onClose if confirm returns true", () => {
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(() => (
      <TabStrip tabs={[dirtyTab]} activeId={null} onSelect={() => {}} onClose={onClose} {...defaultLauncherProps} />
    ));
    fireEvent.click(container.querySelector(".tab-kill")!);
    expect(onClose).toHaveBeenCalledWith("file:src/y.ts");
  });

  test("clicking the launcher primary button calls onLaunch with the last-used entry", () => {
    const onLaunch = vi.fn();
    const { container } = render(() => (
      <TabStrip
        tabs={[]}
        activeId={null}
        onSelect={() => {}}
        onClose={() => {}}
        onLaunch={onLaunch}
        launchers={defaultLaunchers}
        lastUsedLauncher="shell"
        onChangeLastUsedLauncher={() => {}}
      />
    ));
    const primaryBtn = container.querySelector(".launcher-primary")!;
    fireEvent.click(primaryBtn);
    expect(onLaunch).toHaveBeenCalledWith(shellLauncher);
  });

  test("clicking a tab calls onSelect with that id", () => {
    const onSelect = vi.fn();
    render(() => (
      <TabStrip tabs={[termTab, fileTab]} activeId={null} onSelect={onSelect} onClose={() => {}} {...defaultLauncherProps} />
    ));
    fireEvent.click(screen.getByText("term 1"));
    expect(onSelect).toHaveBeenCalledWith("term:1");
  });

  test("terminal tab with no agent renders label without bot prefix", () => {
    render(() => (
      <TabStrip tabs={[termTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(screen.getByText("term 1")).toBeTruthy();
    expect(screen.queryByText(/🤖/)).toBeNull();
  });

  test("terminal tab with an agent shows a leading bot icon", () => {
    render(() => (
      <TabStrip tabs={[agentTermTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(screen.getByText("🤖 term 2")).toBeTruthy();
  });

  test("terminal tab with an agent exposes the agent name via title", () => {
    const { container } = render(() => (
      <TabStrip tabs={[agentTermTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    const tab = container.querySelector(".tab.tab-terminal") as HTMLElement;
    expect(tab.title).toBe("claude");
  });

  test("file tabs get a split button", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeTruthy();
  });

  test("terminal tabs get no split button — a PTY cannot be mounted twice", () => {
    const { container } = render(() => (
      <TabStrip tabs={[termTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeNull();
  });

  test("no split button when the host provides no onToggleSplit", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} {...defaultLauncherProps} />
    ));
    expect(container.querySelector(".tab-split")).toBeNull();
  });

  test("clicking the split button calls onToggleSplit and not onSelect", () => {
    const onToggleSplit = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={onSelect} onClose={() => {}} onToggleSplit={onToggleSplit} {...defaultLauncherProps} />
    ));
    fireEvent.click(container.querySelector(".tab-split")!);
    expect(onToggleSplit).toHaveBeenCalledWith("file:src/x.ts");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the pinned tab gets a pinned class", () => {
    const { container } = render(() => (
      <TabStrip tabs={[termTab, fileTab]} activeId="term:1" secondaryId="file:src/x.ts" onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const pinned = container.querySelector(".tab.pinned");
    expect(pinned?.textContent).toContain("x.ts");
  });

  test("the pinned tab's split button is titled as a way back", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} secondaryId="file:src/x.ts" onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const btn = container.querySelector(".tab-split") as HTMLElement;
    expect(btn.title).toBe("return to left pane");
  });

  test("an unpinned file tab's split button is titled as a way right", () => {
    const { container } = render(() => (
      <TabStrip tabs={[fileTab]} activeId={null} onSelect={() => {}} onClose={() => {}} onToggleSplit={() => {}} {...defaultLauncherProps} />
    ));
    const btn = container.querySelector(".tab-split") as HTMLElement;
    expect(btn.title).toBe("open in right pane");
  });
});
