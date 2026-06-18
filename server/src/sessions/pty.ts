import { spawn as ptySpawn } from "node-pty";
import { read as fsRead } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { IPty, PtyFactory } from "./types";

/**
 * Bun 1.3.x does not drive tty.ReadStream/fs.ReadStream data events for PTY
 * file descriptors (its libuv integration differs from Node.js).  We work
 * around this by:
 *
 *  1. Switching the master PTY fd from non-blocking to blocking via fcntl(2)
 *     using Bun's built-in FFI, so that async fs.read callbacks will block
 *     inside libuv until data arrives instead of returning EAGAIN immediately.
 *  2. Driving a read-loop with async fs.read callbacks (which Bun does
 *     process correctly), emitting data to our own listener arrays.
 *  3. Treating EIO / EBADF from fs.read as the exit signal (the child closing
 *     the slave side of the PTY causes EIO on the master fd).
 *
 * node-pty's native onExit callback still fires in Node.js; we keep that path
 * for correctness but also emit exit ourselves on EIO so that Bun users get
 * the event even when the native path is silent.
 */

// --------------------------------------------------------------------------
// Best-effort fcntl wrapper (removes O_NONBLOCK from the PTY fd).
// Falls back silently if FFI is unavailable (e.g., non-Bun runtimes where the
// tty.ReadStream approach works natively).
// --------------------------------------------------------------------------
function trySetBlocking(fd: number): boolean {
  try {
    // Bun exposes bun:ffi; Node.js does not have this module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const libName =
      process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6";
    const lib = dlopen(libName, {
      fcntl: { args: [FFIType.int, FFIType.int, FFIType.int], returns: FFIType.int },
    });
    const F_GETFL = 3;
    const F_SETFL = 4;
    const O_NONBLOCK = process.platform === "darwin" ? 0x0004 : 0x0800;
    const flags = lib.symbols.fcntl(fd, F_GETFL, 0) as number;
    lib.symbols.fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
    lib.close();
    return true;
  } catch {
    return false;
  }
}

export const nodePtyFactory: PtyFactory = (input) => {
  const raw = ptySpawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    cols: input.cols,
    rows: input.rows,
    name: "xterm-256color",
  });

  const fd: number = (raw as unknown as { _fd?: number })._fd ?? -1;
  if (typeof fd !== "number" || fd < 0) {
    throw new Error("node-pty internals changed: _fd not found or invalid");
  }

  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  let exited = false;

  function emitExit(code: number, signal = 0) {
    if (exited) return;
    exited = true;
    for (const cb of exitListeners) cb({ exitCode: code, signal });
  }

  const buf = Buffer.alloc(65536);
  // StringDecoder buffers partial multi-byte UTF-8 sequences across reads.
  // Without this, a read boundary in the middle of a 2/3/4-byte sequence
  // (e.g. box-drawing U+2500 = 0xE2 0x94 0x80) would corrupt the char.
  const decoder = new StringDecoder("utf8");
  const pid = raw.pid;

  /** Returns false if the process no longer exists. */
  function isAlive(): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  let consecutiveZeroReads = 0;
  const MAX_ZERO_READS = 20; // ~100ms of poll attempts before giving up

  function poll() {
    if (exited) return;
    fsRead(fd, buf, 0, buf.length, null, (err, n) => {
      if (exited) return;
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EAGAIN") {
          // fd is still non-blocking (FFI not available) — retry after a tick.
          setTimeout(poll, 5);
          return;
        }
        // EIO / EBADF: child closed the slave side -> process exited.
        // Defer briefly so node-pty's onExit (which carries the real exitCode) can win.
        setTimeout(() => emitExit(0), 20);
        return;
      }
      if (n > 0) {
        consecutiveZeroReads = 0;
        const chunk = decoder.write(buf.subarray(0, n));
        if (chunk.length > 0) {
          for (const cb of dataListeners) cb(chunk);
        }
        poll();
      } else {
        // n === 0: On macOS the blocking read returns 0 bytes (EOF) after the
        // child exits rather than EIO.  Use pid liveness as a secondary signal.
        if (!isAlive()) {
          emitExit(0);
          return;
        }
        consecutiveZeroReads++;
        if (consecutiveZeroReads >= MAX_ZERO_READS) {
          // Likely PID recycle or stuck slave; treat as exit.
          emitExit(0);
          return;
        }
        setTimeout(poll, 5);
      }
    });
  }

  // Switch to blocking I/O so fsRead waits for data instead of returning EAGAIN.
  // Returns true on Bun (FFI available), false on Node.js.
  const usingShim = trySetBlocking(fd);

  if (usingShim) {
    // Bun path: detach node-pty's tty.ReadStream and drive our own read loop.
    (raw as unknown as { _socket?: { removeAllListeners?: () => void } })
      ._socket?.removeAllListeners?.();
    poll();
  } else {
    // Node.js path: route node-pty's native data events to our listeners.
    raw.onData((data) => {
      for (const cb of dataListeners) cb(data);
    });
  }

  // Keep node-pty's native exit callback as a second path (works in Node.js).
  raw.onExit((e) => emitExit(e.exitCode, e.signal ?? 0));

  return {
    get pid() {
      return raw.pid;
    },
    onData(cb) {
      dataListeners.push(cb);
      return {
        dispose: () => {
          const i = dataListeners.indexOf(cb);
          if (i !== -1) dataListeners.splice(i, 1);
        },
      };
    },
    onExit(cb) {
      exitListeners.push(cb);
      return {
        dispose: () => {
          const i = exitListeners.indexOf(cb);
          if (i !== -1) exitListeners.splice(i, 1);
        },
      };
    },
    write(data) {
      // Once we've observed exit, the master fd is gone — skip the write so
      // node-pty's async write queue doesn't log "Unhandled pty write error".
      if (exited) return;
      try {
        raw.write(data);
      } catch {
        // fd closed between our exit-check and the write — harmless race.
      }
    },
    resize(cols, rows) {
      if (exited) return;
      try {
        raw.resize(cols, rows);
      } catch {
        // ioctl on a closed fd — harmless race during teardown.
      }
    },
    kill(signal) {
      raw.kill(signal);
    },
  };
};
