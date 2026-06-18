import { describe, expect, test } from "bun:test";
import { detectAgentsForPids } from "../src/sessions/agent-detect";

const psSample = `
  PID  PPID COMM
   100   1   /usr/bin/bash
   200   100 /usr/bin/node
   300   200 claude
   400   100 codex
   500   1   bash
   600   500 git
`;

describe("detectAgentsForPids", () => {
  test("walks descendants and matches agent comm", () => {
    const result = detectAgentsForPids({
      psOutput: psSample,
      ptyPids: [100],
      agentNames: ["claude", "codex", "aider"],
    });
    expect(result.get(100)).toBe("claude"); // first found wins; both descendants exist
  });

  test("returns undefined when no agent under the pid", () => {
    const result = detectAgentsForPids({
      psOutput: psSample,
      ptyPids: [500],
      agentNames: ["claude", "codex"],
    });
    expect(result.get(500)).toBeUndefined();
  });

  test("multiple pty pids handled in one pass", () => {
    const result = detectAgentsForPids({
      psOutput: psSample,
      ptyPids: [100, 500],
      agentNames: ["claude", "codex"],
    });
    expect(result.get(100)).toBeDefined();
    expect(result.get(500)).toBeUndefined();
  });
});
