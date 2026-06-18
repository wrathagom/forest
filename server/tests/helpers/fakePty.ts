import type { IPty, PtyFactory, SpawnInput } from "../../src/sessions/types";

export type FakePty = IPty & {
  emitData(data: string): void;
  emitExit(code: number, signal?: number): void;
  writes: string[];
  resizes: { cols: number; rows: number }[];
  killed: { signal?: string }[];
  spawn: SpawnInput;
};

export function makeFakePtyFactory(): { factory: PtyFactory; instances: FakePty[] } {
  const instances: FakePty[] = [];
  const factory: PtyFactory = (input) => {
    const dataCbs = new Set<(d: string) => void>();
    const exitCbs = new Set<(e: { exitCode: number; signal?: number }) => void>();
    const writes: string[] = [];
    const resizes: { cols: number; rows: number }[] = [];
    const killed: { signal?: string }[] = [];
    const fake: FakePty = {
      pid: 99999,
      onData(cb) {
        dataCbs.add(cb);
        return { dispose: () => dataCbs.delete(cb) };
      },
      onExit(cb) {
        exitCbs.add(cb);
        return { dispose: () => exitCbs.delete(cb) };
      },
      write(data) {
        writes.push(data);
      },
      resize(cols, rows) {
        resizes.push({ cols, rows });
      },
      kill(signal) {
        killed.push({ signal });
      },
      emitData(data) {
        for (const cb of dataCbs) cb(data);
      },
      emitExit(code, signal) {
        for (const cb of exitCbs) cb({ exitCode: code, signal });
      },
      writes,
      resizes,
      killed,
      spawn: input,
    };
    instances.push(fake);
    return fake;
  };
  return { factory, instances };
}
