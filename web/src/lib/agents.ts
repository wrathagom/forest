// Distinct glyph per coding agent, shared by the tab strip and the session bar
// so the two surfaces stay consistent. Swap the emoji here to restyle globally.
// One of 3 spots to edit when adding an agent (launcher default + agentNames are
// the others) — see docs/coding-agent-launchers.md.
export const AGENT_ICON: Record<string, string> = {
  claude: "✳️",
  codex: "⚡",
  opencode: "🦙",
};

/** Emoji for an agent id; a generic robot for anything unmapped or absent. */
export function agentIcon(agent?: string | null): string {
  return (agent && AGENT_ICON[agent]) || "🤖";
}
