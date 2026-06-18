import { spawn } from "node:child_process";

export type RunGh = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultRunGh: RunGh = (args, cwd) =>
  new Promise((resolve) => {
    const p = spawn("gh", args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => resolve({ stdout, stderr: stderr || (err as Error).message, code: -1 }));
    p.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });

function firstLine(s: string): string {
  return s.split("\n")[0]!.trim();
}

/**
 * Opens a GitHub PR for `branch` via the `gh` CLI (uses the host's gh auth).
 * The branch must already be pushed. Returns the PR URL `gh` prints.
 */
export async function ghCreatePr(
  cwd: string,
  opts: { branch: string; title: string; body: string },
  run: RunGh = defaultRunGh,
): Promise<{ url: string }> {
  const r = await run(
    ["pr", "create", "--head", opts.branch, "--title", opts.title, "--body", opts.body],
    cwd,
  );
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || `gh pr create exited ${r.code}`);
  // gh prints the PR URL as the last non-empty line of stdout.
  const url = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  return { url };
}
