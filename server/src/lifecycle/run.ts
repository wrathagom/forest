// server/src/lifecycle/run.ts

export type RunResult = {
  exitCode: number;
  output: string; // merged stdout + stderr
  timedOut: boolean;
};

export type RunOptions = { timeoutMs: number };

/**
 * Run `cmd` once through `sh -c` in `cwd`, capturing merged stdout+stderr and
 * the exit code. Aborts after `timeoutMs`, killing the process group. Intended
 * for commands that return promptly and background their real work.
 */
export async function runCommand(cmd: string, cwd: string, opts: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(); // SIGTERM
  }, opts.timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = (stdout + stderr).trim();
    return { exitCode: timedOut ? (exitCode || 124) : exitCode, output, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
