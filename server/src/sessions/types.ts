import type { ScrollbackRingBuffer } from "./ringbuffer";

export interface IPty {
  onData(cb: (data: string) => void): { dispose: () => void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose: () => void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
}

export type SpawnInput = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
};

export type PtyFactory = (input: SpawnInput) => IPty;

export type Session = {
  id: string;
  projectId: string;
  cwd: string;
  command: string;
  args: string[];
  pty: IPty;
  createdAt: number;
  scrollback: ScrollbackRingBuffer;
  attachments: Set<unknown>;
  launcher?: { id: string; agent?: string };
};

export type AttachData = { projectId: string; sessionId: string };

export type ClientFrame =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

export type ServerFrame =
  | { type: "scrollback"; data: string }
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string }
  | { type: "pong" };
