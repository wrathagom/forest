import { describe, expect, test, beforeEach } from "vitest";
import {
  loadOpenFiles,
  saveOpenFiles,
  loadActiveTab,
  saveActiveTab,
  loadExpandedDirs,
  saveExpandedDirs,
  loadSecondaryTab,
  saveSecondaryTab,
  loadSplitRatio,
  saveSplitRatio,
  clampRatio,
  type Tab,
} from "../src/lib/tabs";

beforeEach(() => {
  localStorage.clear();
});

describe("tabs persistence", () => {
  test("openFiles round-trip", () => {
    expect(loadOpenFiles("p1")).toEqual([]);
    saveOpenFiles("p1", ["src/foo.ts", "src/bar.ts"]);
    expect(loadOpenFiles("p1")).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  test("activeTab round-trip", () => {
    expect(loadActiveTab("p1")).toBeNull();
    saveActiveTab("p1", "file:src/foo.ts");
    expect(loadActiveTab("p1")).toBe("file:src/foo.ts");
  });

  test("openFiles is per-project", () => {
    saveOpenFiles("p1", ["a"]);
    saveOpenFiles("p2", ["b"]);
    expect(loadOpenFiles("p1")).toEqual(["a"]);
    expect(loadOpenFiles("p2")).toEqual(["b"]);
  });

  test("expandedDirs round-trip", () => {
    expect(loadExpandedDirs("p1")).toEqual([]);
    saveExpandedDirs("p1", ["src/", "src/ui/"]);
    expect(loadExpandedDirs("p1")).toEqual(["src/", "src/ui/"]);
  });

  test("Tab union compiles for both kinds", () => {
    const t: Tab = { kind: "terminal", id: "term:1", sessionId: "1", label: "term 1", agent: null };
    const f: Tab = { kind: "file", id: "file:src/x.ts", path: "src/x.ts", label: "x.ts", dirty: false };
    expect(t.kind).toBe("terminal");
    expect(f.kind).toBe("file");
  });

  test("Tab union accepts session kind at compile time", () => {
    const t: Tab = { kind: "session", id: "session:abc", sessionId: "abc", label: "thing" };
    expect(t.kind).toBe("session");
  });
});

describe("secondaryTab persistence", () => {
  test("round-trips a valid pinned file", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveActiveTab("p1", "term:1");
    saveSecondaryTab("p1", "file:src/foo.ts");
    expect(loadSecondaryTab("p1")).toBe("file:src/foo.ts");
  });

  test("defaults to null", () => {
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a pin whose file is not open", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveSecondaryTab("p1", "file:src/gone.ts");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a pin equal to the active tab — invariant 2", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveActiveTab("p1", "file:src/foo.ts");
    saveSecondaryTab("p1", "file:src/foo.ts");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects a non-file id", () => {
    saveSecondaryTab("p1", "term:1");
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("rejects garbage", () => {
    localStorage.setItem("forest.secondaryTab.p1", JSON.stringify(42));
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("is per-project", () => {
    saveOpenFiles("p1", ["a"]);
    saveOpenFiles("p2", ["b"]);
    saveSecondaryTab("p1", "file:a");
    saveSecondaryTab("p2", "file:b");
    expect(loadSecondaryTab("p1")).toBe("file:a");
    expect(loadSecondaryTab("p2")).toBe("file:b");
  });

  test("an explicit null pin round-trips as null", () => {
    saveSecondaryTab("p1", null);
    expect(loadSecondaryTab("p1")).toBeNull();
  });

  test("a pin survives when no active tab is stored", () => {
    saveOpenFiles("p1", ["src/foo.ts"]);
    saveSecondaryTab("p1", "file:src/foo.ts");
    expect(loadSecondaryTab("p1")).toBe("file:src/foo.ts");
  });
});

describe("splitRatio persistence", () => {
  test("defaults to 0.5", () => {
    expect(loadSplitRatio("p1")).toBe(0.5);
  });

  test("round-trips", () => {
    saveSplitRatio("p1", 0.35);
    expect(loadSplitRatio("p1")).toBe(0.35);
  });

  test("clamps an out-of-range stored value", () => {
    saveSplitRatio("p1", 0.99);
    expect(loadSplitRatio("p1")).toBe(0.8);
    saveSplitRatio("p1", 0.01);
    expect(loadSplitRatio("p1")).toBe(0.2);
  });

  test("falls back to 0.5 on non-finite or non-numeric values", () => {
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(clampRatio("0.4")).toBe(0.5);
    expect(clampRatio(null)).toBe(0.5);
  });

  test("the clamp bounds are inclusive", () => {
    expect(clampRatio(0.2)).toBe(0.2);
    expect(clampRatio(0.8)).toBe(0.8);
  });
});
