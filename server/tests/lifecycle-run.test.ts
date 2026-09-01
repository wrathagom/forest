// server/tests/lifecycle-run.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/lifecycle/run";

describe("runCommand", () => {
  test("captures stdout and a zero exit code", async () => {
    const r = await runCommand("echo hello", process.cwd(), { timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("hello");
  });

  test("captures a nonzero exit code and stderr", async () => {
    const r = await runCommand("echo oops 1>&2; exit 3", process.cwd(), { timeoutMs: 5000 });
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("oops");
  });

  test("runs in the given cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forest-run-"));
    const r = await runCommand("pwd", dir, { timeoutMs: 5000 });
    // macOS symlinks /tmp -> /private/tmp; compare on the basename to stay portable.
    expect(r.output).toContain(dir.split("/").pop()!);
  });

  test("times out a hanging command", async () => {
    const r = await runCommand("sleep 5", process.cwd(), { timeoutMs: 150 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
  });
});
