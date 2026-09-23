# Coding-agent launchers: current wiring + a deferred refactor

How a coding agent is wired into Forest today, and a single-source-of-truth
refactor that was considered and **deferred** (2026-09-23).

## Context

Forest's launch bar (the `+`/▾ split button in the tab strip) opens a project
terminal that runs a configured command. Each entry is a `LauncherEntry`
(`{ id, label, command, args, agent? }`). The `agent` tag drives two other
behaviours: the tab/session **icon** and process **detection**.

## Adding a coding agent today (the 3 coupled edit sites)

Adding a first-class agent currently means editing **three** places. They are
not derived from each other, so all three must stay in sync:

1. **Launcher default** — `server/src/store/config.ts` → `DEFAULT_LAUNCHERS`
   (add `{ id, label, command, args, agent }`). Note: an instance that already
   has a stored `terminals.launchers` row ignores this default — add the entry
   via **Settings → Launchers** for a live instance.
2. **Icon** — `web/src/lib/agents.ts` → `AGENT_ICON` (map the `agent` id to an
   emoji; otherwise the tab/session shows the generic 🤖 fallback).
3. **Process detection** — `server/src/index.ts` → `agentNames` (the list the
   `AgentDetector` matches against a terminal's child-process names, by
   priority). Without this, a launched agent's terminal won't be attributed to
   that agent.

## Deferred refactor: make the launcher the single source of truth

**Wish:** creating a new agent launcher should carry its icon and detection with
it, so there's one place to edit — not three.

Two ways to do it, both deferred in favour of the 3-site edit for now:

- **Option A (minimal):** add `icon?` to `LauncherEntry`; derive `AGENT_ICON`
  and `agentNames` from the launchers config (union of `agent` tags and command
  basenames; "first launcher defining an icon for that agent wins"). Keep a tiny
  built-in fallback so nothing regresses before config loads. **Cost:**
  `SessionBar` (a top-level component that currently doesn't see launchers) must
  read the launchers config via the existing settings-config context.
  `TabStrip` already receives `launchers`.
- **Option B (correct unit):** introduce an explicit `agents` registry in config
  (`{ id, icon, detect: string[] }`); launchers reference an agent id. Cleaner
  (no duplication; supports launcher-less agents like task runs and
  detection-only agents), but adds a new config key **and** a Settings section.

**Why deferred:** the payoff is maintainability, not user-facing behaviour, and
there's a real cardinality mismatch to respect — an *agent* is not a *launcher*.
Multiple launchers share one agent (`claude` plain + `--resume`), and agents
also appear with **no launcher** (task runs and detected sessions hardcode
`agent: "claude"`; see `server/src/sessions/{live,parser,runner}.ts` and
`routes/{sessions,tasks}.ts`). Any refactor must keep icons/detection working
for those launcher-less cases. Option A handles this with a fallback map;
Option B models it directly.

When the agent count grows or detection-only cases appear, revisit — Option A
first, Option B if it outgrows that.
