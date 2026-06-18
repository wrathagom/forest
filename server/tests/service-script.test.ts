import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve(import.meta.dir, "..", "..", "scripts", "forest-service.sh");
const REPO_DIR = resolve(import.meta.dir, "..", "..");
const PLATFORM = process.platform; // "darwin" | "linux" | …
const SUPPORTED = PLATFORM === "darwin" || PLATFORM === "linux";

function runScript(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bash", SCRIPT, ...args], { env: { ...process.env, ...env }, cwd: REPO_DIR });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), code: proc.exitCode };
}

describe("forest-service.sh", () => {
  test("--help prints usage and exits 0", () => {
    const { stdout, code } = runScript(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("forest-service.sh");
    for (const w of ["install", "uninstall", "restart", "status", "--dry-run"]) expect(stdout).toContain(w);
  });

  test("no args prints usage", () => {
    const { stdout, code } = runScript([]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage:");
  });

  test("unknown subcommand exits 1", () => {
    const { code, stderr } = runScript(["wat"]);
    expect(code).toBe(1);
    expect(stderr).toContain("usage:");
  });

  test.skipIf(!SUPPORTED)("install --dry-run renders the service file and touches nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "forest-svc-"));
    const { stdout, code } = runScript(["install", "--dry-run", "--port", "59999"], {
      HOME: home,
      XDG_DATA_HOME: join(home, "data"),
      XDG_CONFIG_HOME: join(home, "config"),
    });
    expect(code).toBe(0);
    expect(readdirSync(home)).toHaveLength(0); // --dry-run wrote nothing
    expect(stdout).not.toContain("building web UI");
    expect(stdout).toContain("build:web");
    expect(stdout).toContain(`${REPO_DIR}/server/src/index.ts`);
    expect(stdout).toContain(`${REPO_DIR}/web/dist`);
    expect(stdout).toContain("59999");
    expect(stdout).toContain(join(home, "data", "forest", "logs"));
    const bunPath = Bun.which("bun");
    if (bunPath) expect(stdout).toContain(bunPath);

    // the service env carries a real PATH (so the detached service can find docker, etc.)
    expect(stdout).toContain(process.env.PATH ?? "");

    if (PLATFORM === "darwin") {
      expect(stdout).toContain("<key>Label</key>");
      expect(stdout).toContain("com.user.forest");
      expect(stdout).toContain("<key>KeepAlive</key>");
      expect(stdout).toContain("<key>PATH</key>");
      expect(stdout).toContain(join(home, "Library", "LaunchAgents", "com.user.forest.plist"));
      expect(stdout).toContain("would run: launchctl bootstrap");
    } else {
      expect(stdout).toContain("[Service]");
      expect(stdout).toContain("Restart=always");
      expect(stdout).toContain("WantedBy=default.target");
      expect(stdout).toContain('Environment="PATH=');
      expect(stdout).toContain(join(home, "config", "systemd", "user", "forest.service"));
      expect(stdout).toContain("would run: systemctl --user enable --now forest.service");
    }
  });

  test.skipIf(!SUPPORTED)("restart --dry-run on a not-installed service still works as a dry run", () => {
    const home = mkdtempSync(join(tmpdir(), "forest-svc-"));
    const { stdout, code } = runScript(["restart", "--dry-run"], { HOME: home, XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config") });
    expect(code).toBe(0);
    expect(stdout).toContain("build:web");
    if (PLATFORM === "darwin") expect(stdout).toContain("would run: launchctl kickstart");
    else expect(stdout).toContain("would run: systemctl --user restart forest.service");
  });
});
