// server/src/lifecycle/run.ts

export type RunResult = {
  exitCode: number;
  output: string; // merged stdout + stderr, best-effort
  timedOut: boolean;
};

export type RunOptions = { timeoutMs: number };

/**
 * Run `cmd` once through `sh -c` in `cwd`, capturing merged stdout+stderr and
 * the exit code. Intended for commands that return promptly and background
 * their real work. Never blocks on stream EOF: a backgrounded child can inherit
 * the output pipe and hold it open long after the command itself exits, so we
 * resolve as soon as the command process exits (with a brief drain) and cancel
 * the readers. On timeout the command process is signalled (SIGTERM).
 */
export async function runCommand(cmd: string, cwd: string, opts: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });

  const decoder = new TextDecoder();
  let output = "";
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    readers.push(reader);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) output += decoder.decode(value, { stream: true });
      }
    } catch {
      // reader cancelled — expected when we stop draining
    }
  };
  const pumps = [pump(proc.stdout), pump(proc.stderr)];

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(); // SIGTERM the command process
  }, opts.timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  // Drain briefly for any final buffered output, then stop — never wait on EOF,
  // which a backgrounded grandchild may hold open indefinitely.
  await Promise.race([Promise.all(pumps), Bun.sleep(75)]);
  for (const r of readers) {
    try { await r.cancel(); } catch { /* already done */ }
  }

  return { exitCode, output: output.trim(), timedOut };
}
