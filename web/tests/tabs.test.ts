import { describe, expect, test, beforeEach } from "vitest";
import {
  loadOpenFiles,
  saveOpenFiles,
  loadActiveTab,
  saveActiveTab,
  loadExpandedDirs,
  saveExpandedDirs,
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
