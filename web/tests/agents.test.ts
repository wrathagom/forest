import { describe, expect, it } from "vitest";
import { agentIcon } from "../src/lib/agents";

describe("agentIcon", () => {
  it("maps known agents to distinct emoji", () => {
    expect(agentIcon("claude")).toBe("✳️");
    expect(agentIcon("codex")).toBe("⚡");
    expect(agentIcon("claude")).not.toBe(agentIcon("codex"));
  });
  it("falls back to a generic robot for unknown/absent agents", () => {
    expect(agentIcon("aider")).toBe("🤖");
    expect(agentIcon(null)).toBe("🤖");
    expect(agentIcon(undefined)).toBe("🤖");
  });
});
