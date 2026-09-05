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

  test("parses url alongside commands", () => {
    const dir = tmpProject("start: make up\nurl: http://localhost:3000\n");
    expect(readConfig(dir)).toEqual({ start: "make up", url: "http://localhost:3000" });
  });

  test("a url-only forest.yaml is a valid config", () => {
    const dir = tmpProject("url: http://localhost:8080\n");
    expect(readConfig(dir)).toEqual({ url: "http://localhost:8080" });
  });

  test("drops an empty url", () => {
    const dir = tmpProject("start: make up\nurl: '   '\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("drops a non-http(s) url (e.g. javascript:)", () => {
    const dir = tmpProject('start: make up\nurl: "javascript:alert(1)"\n');
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("a url-only file with a non-http(s) scheme is not a valid config", () => {
    const dir = tmpProject('url: "javascript:alert(1)"\n');
    expect(readConfig(dir)).toBeNull();
  });

  test("parses a sections map with per-section keys", () => {
    const dir = tmpProject(
      "start: godot --editor .\n" +
      "sections:\n" +
      "  game:\n" +
      "    start: godot .\n" +
      "    stop: pkill -f godot\n" +
      "    url: http://localhost:8060\n" +
      "    health: pgrep -f godot\n",
    );
    expect(readConfig(dir)).toEqual({
      start: "godot --editor .",
      sections: {
        game: { start: "godot .", stop: "pkill -f godot", url: "http://localhost:8060", health: "pgrep -f godot" },
      },
    });
  });

  test("a sections-only forest.yaml is a valid config", () => {
    const dir = tmpProject("sections:\n  game:\n    start: godot .\n");
    expect(readConfig(dir)).toEqual({ sections: { game: { start: "godot ." } } });
  });

  test("drops a section with no usable keys", () => {
    const dir = tmpProject("start: make up\nsections:\n  empty:\n    name: nope\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("drops a section's non-http(s) url but keeps its commands", () => {
    const dir = tmpProject('sections:\n  game:\n    start: godot .\n    url: "javascript:alert(1)"\n');
    expect(readConfig(dir)).toEqual({ sections: { game: { start: "godot ." } } });
  });

  test("ignores a non-object sections value", () => {
    const dir = tmpProject("start: make up\nsections: nope\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("parses multiple named sections", () => {
    const dir = tmpProject(
      "sections:\n" +
      "  game:\n    start: godot .\n" +
      "  editor:\n    start: godot --editor .\n",
    );
    expect(readConfig(dir)).toEqual({
      sections: { game: { start: "godot ." }, editor: { start: "godot --editor ." } },
    });
  });

  test("ignores an array sections value", () => {
    const dir = tmpProject("start: make up\nsections:\n  - 1\n  - 2\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });

  test("drops a section whose value is an array", () => {
    const dir = tmpProject("start: make up\nsections:\n  game:\n    - 1\n    - 2\n");
    expect(readConfig(dir)).toEqual({ start: "make up" });
  });
});
