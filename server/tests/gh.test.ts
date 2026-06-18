import { describe, expect, test } from "bun:test";
import type { RunGh } from "../src/gh";
import { ghCreatePr } from "../src/gh";

function fakeGh(result: { stdout?: string; stderr?: string; code: number }) {
  const calls: string[][] = [];
  const run: RunGh = async (args) => {
    calls.push(args);
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
  };
  return { run, calls };
}

describe("ghCreatePr", () => {
  test("runs `gh pr create` with head/title/body and returns the URL", async () => {
    const { run, calls } = fakeGh({ code: 0, stdout: "https://github.com/me/repo/pull/7\n" });
    const r = await ghCreatePr("/repo", { branch: "task/go", title: "Go", body: "do it" }, run);
    expect(calls[0]).toEqual([
      "pr", "create", "--head", "task/go", "--title", "Go", "--body", "do it",
    ]);
    expect(r.url).toBe("https://github.com/me/repo/pull/7");
  });
  test("throws on non-zero exit", async () => {
    const { run } = fakeGh({ code: 1, stderr: "no auth\n" });
    expect(ghCreatePr("/repo", { branch: "b", title: "t", body: "x" }, run)).rejects.toThrow("no auth");
  });
});
