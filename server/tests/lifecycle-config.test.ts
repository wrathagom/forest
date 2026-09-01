// server/tests/lifecycle-config.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/lifecycle/config";

function tmpProject(yaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forest-cfg-"));
  if (yaml !== undefined) writeFileSync(join(dir, "forest.yaml"), yaml);
  return dir;
}

describe("readConfig", () => {
  test("parses start/stop/health", () => {
    const dir = tmpProject("start: docker compose up -d\nstop: docker compose down\nhealth: curl -fsS localhost:3000/up\n");
    expect(readConfig(dir)).toEqual({
      start: "docker compose up -d",
      stop: "docker compose down",
      health: "curl -fsS localhost:3000/up",
    });
  });

  test("returns null when the file is absent", () => {
    expect(readConfig(tmpProject())).toBeNull();
  });

  test("returns null on malformed YAML", () => {
    expect(readConfig(tmpProject("start: [unterminated\n"))).toBeNull();
  });

  test("keeps only string command keys, ignores extras", () => {
    const dir = tmpProject("start: make up\nname: ignored\nport: 3000\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("returns null when no command keys are present", () => {
    expect(readConfig(tmpProject("name: just-a-name\n"))).toBeNull();
  });
});
