import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route, A } from "@solidjs/router";
import { createSignal } from "solid-js";
import { useUnsavedGuard } from "../src/lib/settings-dirty";
import UnsavedDialog from "../src/components/settings/UnsavedDialog";

function Section(props: { save: () => Promise<void>; reset: () => void; keepDirty?: boolean }) {
  const [value, setValue] = createSignal("original");
  const [baseline, setBaseline] = createSignal("original");
  const guard = useUnsavedGuard(
    () => value() !== baseline(),
    async () => { await props.save(); if (!props.keepDirty) setBaseline(value()); },
    () => { props.reset(); setValue(baseline()); },
  );
  return (
    <div>
      <input aria-label="field" value={value()} oninput={(e) => setValue(e.currentTarget.value)} />
      <A href="/other">leave</A>
      <UnsavedDialog guard={guard} />
    </div>
  );
}

function setup(save = vi.fn(async () => {}), reset = vi.fn(), keepDirty = false) {
  // The browser Router reads window.location, so seed it before rendering.
  window.history.replaceState(null, "", "/section");
  render(() => (
    <Router>
      <Route
        path="/section"
        component={() => <Section save={save} reset={reset} keepDirty={keepDirty} />}
      />
      <Route path="/other" component={() => <div>elsewhere</div>} />
    </Router>
  ));
  return { save, reset };
}

const dirtyThenLeave = async () => {
  fireEvent.input(screen.getByLabelText("field"), { target: { value: "changed" } });
  fireEvent.click(screen.getByText("leave"));
};

beforeEach(() => vi.restoreAllMocks());

describe("useUnsavedGuard", () => {
  test("a clean section navigates with no dialog", async () => {
    setup();
    fireEvent.click(screen.getByText("leave"));
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("a dirty section is blocked and prompts", async () => {
    setup();
    await dirtyThenLeave();
    expect(await screen.findByText(/unsaved changes/i)).toBeTruthy();
    expect(screen.queryByText("elsewhere")).toBeNull();
  });

  test("save and continue persists then navigates", async () => {
    const { save } = setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("discard resets then navigates without saving", async () => {
    const { save, reset } = setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByRole("button", { name: /discard/i }));
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("cancel stays put with the edit intact", async () => {
    setup();
    await dirtyThenLeave();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull());
    expect(screen.queryByText("elsewhere")).toBeNull();
    expect((screen.getByLabelText("field") as HTMLInputElement).value).toBe("changed");
  });

  // retry(true) must skip re-running the leave handlers. A section that is
  // still dirty after its save would otherwise re-block its own retry and
  // re-open the dialog forever.
  test("the retried navigation is not re-blocked when the section stays dirty", async () => {
    const { save } = setup(vi.fn(async () => {}), vi.fn(), true);
    await dirtyThenLeave();
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });

  test("a failed save keeps the section put and surfaces the error", async () => {
    const { save } = setup(vi.fn(async () => { throw new Error("boom"); }));
    await dirtyThenLeave();
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(await screen.findByText(/boom/)).toBeTruthy();
    expect(screen.queryByText("elsewhere")).toBeNull();
    expect(screen.queryByText(/unsaved changes/i)).toBeTruthy();

    // Cancelling must not leave the stale error to reappear on the next block.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull());
    fireEvent.click(screen.getByText("leave"));
    expect(await screen.findByText(/unsaved changes/i)).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  test("a dirty section warns on tab close, a clean one does not", async () => {
    setup();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.input(screen.getByLabelText("field"), { target: { value: "changed" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
