import { test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import LauncherButton from "../src/components/LauncherButton";

const launchers = [
  { id: "shell", label: "shell", command: null, args: [] },
  { id: "claude", label: "claude", command: "claude", args: [], agent: "claude" },
];

test("body click invokes onLaunch with last-used (or first) entry", () => {
  const onLaunch = vi.fn();
  const { getByTitle } = render(() => (
    <LauncherButton
      launchers={launchers}
      lastUsedId="claude"
      onLaunch={onLaunch}
      onChangeLastUsed={() => {}}
    />
  ));
  fireEvent.click(getByTitle("new terminal: claude"));
  expect(onLaunch).toHaveBeenCalledWith(launchers[1]);
});

test("chevron click opens menu; selecting changes last-used and launches", () => {
  const onLaunch = vi.fn();
  const onChangeLastUsed = vi.fn();
  const { getByTitle, getByText } = render(() => (
    <LauncherButton
      launchers={launchers}
      lastUsedId="shell"
      onLaunch={onLaunch}
      onChangeLastUsed={onChangeLastUsed}
    />
  ));
  fireEvent.click(getByTitle("choose launcher"));
  fireEvent.click(getByText("claude"));
  expect(onChangeLastUsed).toHaveBeenCalledWith("claude");
  expect(onLaunch).toHaveBeenCalledWith(launchers[1]);
});
