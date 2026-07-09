import { describe, expect, test } from "vitest";
import { splitRight, selectTab, closeTab, reconcilePanes, type PaneState } from "../src/lib/panes";
import type { Tab } from "../src/lib/tabs";

const term: Tab = { kind: "terminal", id: "term:1", sessionId: "1", label: "term 1", agent: null };
const fileA: Tab = { kind: "file", id: "file:a.ts", path: "a.ts", label: "a.ts", dirty: false };
const fileB: Tab = { kind: "file", id: "file:b.ts", path: "b.ts", label: "b.ts", dirty: false };

/** Invariant 2 from the spec: a file never has two editors. */
function assertInvariant(s: PaneState) {
  if (s.activeId !== null) expect(s.activeId).not.toBe(s.secondaryId);
}

describe("splitRight", () => {
  test("pins a non-active file, leaving activeId alone", () => {
    const s = splitRight([term, fileA, fileB], { activeId: "term:1", secondaryId: null }, "file:b.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:b.ts" });
    assertInvariant(s);
  });

  test("pinning the active file moves activeId to the next tab", () => {
    const s = splitRight([term, fileA], { activeId: "file:a.ts", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("splitting the only tab opens it left instead — split is meaningless with one file", () => {
    const s = splitRight([fileA], { activeId: "file:a.ts", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
    assertInvariant(s);
  });

  test("a null activeId is filled from the remaining tabs rather than left empty", () => {
    const s = splitRight([term, fileA], { activeId: null, secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("refuses non-file ids — terminals may never be pinned right", () => {
    const before: PaneState = { activeId: "file:a.ts", secondaryId: null };
    expect(splitRight([term, fileA], before, "term:1")).toEqual(before);
  });

  test("refuses unknown ids", () => {
    const before: PaneState = { activeId: "file:a.ts", secondaryId: null };
    expect(splitRight([fileA], before, "file:gone.ts")).toEqual(before);
  });

  test("re-pinning the already-pinned file is a no-op", () => {
    const before: PaneState = { activeId: "term:1", secondaryId: "file:b.ts" };
    expect(splitRight([term, fileA, fileB], before, "file:b.ts")).toEqual(before);
  });
});

describe("selectTab", () => {
  test("clicking a normal tab makes it active", () => {
    const s = selectTab({ activeId: "term:1", secondaryId: "file:b.ts" }, "file:a.ts");
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: "file:b.ts" });
    assertInvariant(s);
  });

  test("clicking the pinned tab unpins it and makes it active", () => {
    const s = selectTab({ activeId: "term:1", secondaryId: "file:b.ts" }, "file:b.ts");
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: null });
    assertInvariant(s);
  });
});

describe("closeTab", () => {
  test("closing the pinned tab clears the pin and leaves activeId alone", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: "file:b.ts" }, "file:b.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
    assertInvariant(s);
  });

  test("closing the active tab skips over the pinned one when picking the next", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: "file:a.ts" }, "term:1");
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("closing the last non-pinned tab leaves activeId null and the pin intact", () => {
    const s = closeTab([term, fileA], { activeId: "term:1", secondaryId: "file:a.ts" }, "term:1");
    expect(s).toEqual({ activeId: null, secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("closing an inactive, unpinned tab changes nothing", () => {
    const s = closeTab([term, fileA, fileB], { activeId: "term:1", secondaryId: null }, "file:a.ts");
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
  });
});

describe("reconcilePanes", () => {
  test("drops a pinned id whose tab no longer exists", () => {
    const s = reconcilePanes([term], { activeId: "term:1", secondaryId: "file:gone.ts" });
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
  });

  test("drops a non-file pinned id", () => {
    const s = reconcilePanes([term, fileA], { activeId: "file:a.ts", secondaryId: "term:1" });
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
  });

  test("replaces a stale activeId with the first tab that is not pinned", () => {
    const s = reconcilePanes([term, fileA], { activeId: "term:gone", secondaryId: "term:1" });
    // "term:1" is not a file id, so the pin is dropped first, then activeId falls to term:1.
    expect(s).toEqual({ activeId: "term:1", secondaryId: null });
    assertInvariant(s);
  });

  test("a stale activeId never resolves to the pinned file — the invariant-2 regression", () => {
    // This is the bug in ProjectDetail.tsx:103, which falls back to fileTabs[0]
    // with no knowledge of the pin.
    const s = reconcilePanes([fileA, fileB], { activeId: "term:gone", secondaryId: "file:a.ts" });
    expect(s).toEqual({ activeId: "file:b.ts", secondaryId: "file:a.ts" });
    assertInvariant(s);
  });

  test("unpins rather than blanking when the pinned file is the only tab left", () => {
    const s = reconcilePanes([fileA], { activeId: "term:gone", secondaryId: "file:a.ts" });
    expect(s).toEqual({ activeId: "file:a.ts", secondaryId: null });
    assertInvariant(s);
  });

  test("no tabs at all yields a fully empty state", () => {
    expect(reconcilePanes([], { activeId: "term:1", secondaryId: "file:a.ts" })).toEqual({
      activeId: null,
      secondaryId: null,
    });
  });
});
