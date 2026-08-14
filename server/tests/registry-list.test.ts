import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/sessions/registry";

function fakePty() {
  return {
    pid: Math.floor(Math.random() * 100000),
    onData() {}, onExit() {}, write() {}, resize() {}, kill() {},
  };
}

describe("SessionRegistry.list", () => {
  test("returns every live session across projects", () => {
    const reg = new SessionRegistry({
      pty: () => fakePty() as any,
      maxTotal: 10,
      maxScrollbackBytes: 1000,
      defaultShell: "/bin/zsh",
    });
    reg.create({ projectId: "a", cwd: "/a", cols: 80, rows: 24, launcher: { id: "codex", agent: "codex" } });
    reg.create({ projectId: "b", cwd: "/b", cols: 80, rows: 24 });
    expect(reg.list()).toHaveLength(2);
    expect(reg.list().map((s) => s.cwd).sort()).toEqual(["/a", "/b"]);
  });
});
