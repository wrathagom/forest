import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeDocker } from "../src/scanner/docker";

function makeProject(compose: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forest-docker-"));
  writeFileSync(join(dir, "docker-compose.yml"), compose);
  return dir;
}

const fixturePsRunning = readFileSync(join(__dirname, "helpers/fixtures/compose-ps.json"), "utf8");

describe("probeDocker", () => {
  test("returns empty services when no compose file is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forest-nodocker-"));
    const probe = probeDocker({ runDockerCli: async () => "" });
    const out = await probe(dir, new AbortController().signal);
    expect(out.services).toEqual([]);
  });

  test("maps declared services to running state from compose ps output", async () => {
    const dir = makeProject("services:\n  db:\n    image: postgres\n  cache:\n    image: redis\n");
    const probe = probeDocker({ runDockerCli: async () => fixturePsRunning });
    const out = await probe(dir, new AbortController().signal);
    const states = Object.fromEntries(out.services.map((s) => [s.name, s.state]));
    expect(states).toEqual({ db: "running", cache: "stopped" });
    expect(out.errors ?? []).toEqual([]);
  });

  test("returns no services and no errors when the docker daemon is unreachable", async () => {
    const dir = makeProject("services:\n  db:\n    image: postgres\n");
    const probe = probeDocker({
      runDockerCli: async () => {
        throw new Error("docker daemon not running");
      },
    });
    const out = await probe(dir, new AbortController().signal);
    expect(out.services).toEqual([]);
    expect(out.errors ?? []).toEqual([]);
  });
});
