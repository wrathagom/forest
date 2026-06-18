import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitInit, gitCommit } from "../src/git";

describe("blank-init smoke (real git)", () => {
  test("creates a repo on the main branch with one commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forest-blank-smoke-"));
    mkdirSync(dir, { recursive: true });

    await gitInit(dir);
    writeFileSync(join(dir, "README.md"), "# smoke\n");

    // Configure a deterministic identity so the commit succeeds without depending on global git config.
    execSync('git config user.email "smoke@forest.test"', { cwd: dir });
    execSync('git config user.name "Forest Smoke"', { cwd: dir });

    await gitCommit(dir, "initial commit", ["README.md"]);

    expect(existsSync(join(dir, ".git"))).toBe(true);
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir }).toString().trim();
    expect(branch).toBe("main");
    const log = execSync("git log --oneline", { cwd: dir }).toString();
    expect(log).toMatch(/initial commit/);
  });
});
