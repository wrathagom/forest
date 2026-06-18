import { describe, expect, test } from "bun:test";
import { createLoop } from "../src/loop";
import { emptySnapshot } from "../src/scanner/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createLoop", () => {
  test("scans every visible project on each tick", async () => {
    const calls: string[] = [];
    const loop = createLoop({
      intervalMs: 30,
      listVisible: () => [
        { id: "a", path: "/a" },
        { id: "b", path: "/b" },
      ],
      scanProject: async (path) => {
        calls.push(path);
        return emptySnapshot();
      },
      onSnapshot: () => {},
      log: () => {},
    });
    loop.start();
    await wait(80);
    loop.stop();
    expect(calls.filter((c) => c === "/a").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c === "/b").length).toBeGreaterThanOrEqual(2);
  });

  test("refresh runs immediately and writes a snapshot", async () => {
    const written: string[] = [];
    const loop = createLoop({
      intervalMs: 60_000,
      listVisible: () => [{ id: "a", path: "/a" }],
      scanProject: async (path) => emptySnapshot(),
      onSnapshot: (id) => written.push(id),
      log: () => {},
    });
    await loop.refresh("a");
    expect(written).toEqual(["a"]);
  });

  test("refresh on unknown project returns null", async () => {
    const loop = createLoop({
      intervalMs: 60_000,
      listVisible: () => [],
      scanProject: async () => emptySnapshot(),
      onSnapshot: () => {},
      log: () => {},
    });
    const res = await loop.refresh("nope");
    expect(res).toBeNull();
  });
});
