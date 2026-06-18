import { describe, expect, test, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { persistedSignal } from "../src/lib/persisted";

beforeEach(() => {
  localStorage.clear();
});

describe("persistedSignal", () => {
  test("returns the fallback when no value is stored", () => {
    createRoot(() => {
      const [val] = persistedSignal("k1", false);
      expect(val()).toBe(false);
    });
  });

  test("reads a previously stored value", () => {
    localStorage.setItem("forest.k2", JSON.stringify(true));
    createRoot(() => {
      const [val] = persistedSignal("k2", false);
      expect(val()).toBe(true);
    });
  });

  test("setter writes to localStorage", () => {
    createRoot(() => {
      const [, setVal] = persistedSignal("k3", "a");
      setVal("b");
      expect(localStorage.getItem("forest.k3")).toBe(JSON.stringify("b"));
    });
  });

  test("falls back when localStorage throws on read", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try {
      createRoot(() => {
        const [val] = persistedSignal("k4", "fallback");
        expect(val()).toBe("fallback");
      });
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  test("falls back when localStorage throws on write", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("quota"); };
    try {
      createRoot(() => {
        const [val, setVal] = persistedSignal("k5", "a");
        setVal("b"); // must not throw
        expect(val()).toBe("b");
      });
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
