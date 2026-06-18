import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeContainerDetail } from "../src/scanner/docker";

const fixture = readFileSync(join(__dirname, "helpers/fixtures/compose-ps-detail.json"), "utf8");

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "forest-cdetail-"));
  writeFileSync(
    join(dir, "docker-compose.yml"),
    "services:\n  db:\n    image: postgres\n  cache:\n    image: redis\n",
  );
  return dir;
}

describe("probeContainerDetail", () => {
  test("returns empty when no compose file is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forest-no-compose-"));
    const probe = probeContainerDetail({ runDockerCli: async () => "" });
    const out = await probe(dir);
    expect(out).toEqual([]);
  });

  test("maps Publishers, state, image, exitCode, health", async () => {
    const dir = makeProject();
    const probe = probeContainerDetail({ runDockerCli: async () => fixture });
    const out = await probe(dir);
    expect(out).toHaveLength(2);

    const db = out.find((c) => c.service === "db")!;
    expect(db.state).toBe("running");
    expect(db.image).toBe("postgres:16");
    expect(db.containerName).toBe("demo-db-1");
    expect(db.ports).toEqual([{ host: "0.0.0.0", container: 5432, protocol: "tcp" }]);
    expect(db.health).toBe("healthy");
    expect(db.exitCode).toBe(0);

    const cache = out.find((c) => c.service === "cache")!;
    expect(cache.state).toBe("exited");
    expect(cache.exitCode).toBe(1);
    expect(cache.health).toBeNull();
    expect(cache.ports).toEqual([]);
  });

  test("returns empty when docker daemon is unreachable", async () => {
    const dir = makeProject();
    const probe = probeContainerDetail({
      runDockerCli: async () => {
        throw new Error("docker daemon not running");
      },
    });
    const out = await probe(dir);
    expect(out).toEqual([]);
  });
});
