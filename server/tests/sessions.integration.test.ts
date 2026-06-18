import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/sessions/registry";
import { nodePtyFactory } from "../src/sessions/pty";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Sessions integration (real PTY)", () => {
  test("echo runs, output appears in scrollback, exit fires", async () => {
    const reg = new SessionRegistry({
      pty: nodePtyFactory,
      maxTotal: 4,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 5,
      exitRetentionMs: 200,
    });

    const s = reg.create({
      projectId: "p1",
      cwd: process.cwd(),
      command: "/bin/echo",
      args: ["hello-forest"],
      cols: 80,
      rows: 24,
    });

    await wait(150);
    expect(s.scrollback.toString()).toContain("hello-forest");
    await wait(220);
    expect(reg.get(s.id)).toBeUndefined();
  });

  test("captures large output across multiple poll iterations", async () => {
    const reg = new SessionRegistry({
      pty: nodePtyFactory,
      maxTotal: 4,
      maxScrollbackBytes: 1_000_000,
      defaultShell: "/bin/bash",
      coalesceMs: 5,
      exitRetentionMs: 5_000,
    });

    // Print 5000 lines of 'X' — well over the 64KB read buffer.
    const s = reg.create({
      projectId: "p1",
      cwd: process.cwd(),
      command: "/bin/bash",
      args: ["-c", "yes X | head -n 5000"],
      cols: 80,
      rows: 24,
    });

    await wait(800);
    const out = s.scrollback.toString();
    // Lines should be many; assert at least 4000 'X' lines arrived.
    const xLines = out.split("\n").filter((l) => l.trim() === "X");
    expect(xLines.length).toBeGreaterThanOrEqual(4000);
  });

  test("write → cat → output round-trip", async () => {
    const reg = new SessionRegistry({
      pty: nodePtyFactory,
      maxTotal: 4,
      maxScrollbackBytes: 200_000,
      defaultShell: "/bin/bash",
      coalesceMs: 5,
      exitRetentionMs: 200,
    });

    const s = reg.create({
      projectId: "p1",
      cwd: process.cwd(),
      command: "/bin/cat",
      args: [],
      cols: 80,
      rows: 24,
    });

    await wait(50);
    s.pty.write("ping-forest\n");
    await wait(150);
    expect(s.scrollback.toString()).toContain("ping-forest");
    reg.kill(s.id);
    await wait(50);
  });
});
