import type { Database } from "bun:sqlite";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { Vault, type IngestSource } from "./vault";
import { parseClaudeJsonlLine } from "./parser";
import type { ClaudeConfigDir } from "./config-dirs";

export type ScanInput = {
  db: Database;
  vault: Vault;
  configDirs: ClaudeConfigDir[];  // each dir's transcripts are under <path>/projects
  projects: Array<{ id: string; path: string }>;
  source?: IngestSource;          // default "scan"
  onlySessionIds?: Set<string>;   // narrow scope (used by hook receiver)
};

export type ScanResult = {
  filesProcessed: number;
  sessionsTouched: number;
  unrecognized: number;
};

export function classifyCwd(
  cwd: string,
  projects: Array<{ id: string; path: string }>,
): { projectId: string | null; worktreeLabel: string | null } {
  let best: { id: string; path: string } | null = null;
  for (const p of projects) {
    if ((cwd === p.path || cwd.startsWith(p.path + "/")) && (!best || p.path.length > best.path.length)) {
      best = p;
    }
  }
  if (!best) return { projectId: null, worktreeLabel: null };
  if (cwd === best.path) return { projectId: best.id, worktreeLabel: "main" };
  const rel = cwd.slice(best.path.length + 1);
  if (rel.startsWith(".worktrees/")) {
    const label = rel.slice(".worktrees/".length).split("/")[0]!;
    return { projectId: best.id, worktreeLabel: label };
  }
  return { projectId: best.id, worktreeLabel: "main" };
}

export async function scanClaudeProjects(input: ScanInput): Promise<ScanResult> {
  const result: ScanResult = { filesProcessed: 0, sessionsTouched: 0, unrecognized: 0 };
  for (const cfg of input.configDirs) {
    const projectsRoot = join(cfg.path, "projects");
    if (!existsSync(projectsRoot)) continue;
    const slugDirs = readdirSync(projectsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of slugDirs) {
      const slugPath = join(projectsRoot, dir.name);
      const files = readdirSync(slugPath, { withFileTypes: true }).filter(
        (f) => f.isFile() && f.name.endsWith(".jsonl"),
      );
      for (const f of files) {
        const sid = basename(f.name, ".jsonl");
        if (input.onlySessionIds && !input.onlySessionIds.has(sid)) continue;
        const full = join(slugPath, f.name);
        const mtime = Math.floor(statSync(full).mtimeMs);
        const known = input.vault.mtimeFor(sid);
        if (known !== undefined && known >= mtime) continue;
        await ingestJsonlFile(input, full, sid, mtime, cfg.profile);
        result.filesProcessed++;
        result.sessionsTouched++;
      }
    }
  }
  return result;
}

async function ingestJsonlFile(
  input: ScanInput,
  fullPath: string,
  sessionId: string,
  fileMtime: number,
  profile: string,
): Promise<void> {
  const text = await Bun.file(fullPath).text();
  const lines = text.split("\n").filter((l) => l.length > 0);

  let firstSession: ReturnType<typeof parseClaudeJsonlLine> | null = null;
  const allMessages: Parameters<Vault["upsertMessages"]>[0] = [];
  const allFts: Parameters<Vault["upsertMessages"]>[1] = [];
  const allToolCalls: Parameters<Vault["upsertToolCalls"]>[0] = [];
  const allToolResults: Parameters<Vault["applyToolResults"]>[0] = [];
  const allEvents: Parameters<Vault["appendEvents"]>[0] = [];

  for (const line of lines) {
    const out = parseClaudeJsonlLine(line);
    if (!out.ok) continue; // unrecognized lines are silently dropped here
    if (!firstSession) firstSession = out;
    allMessages.push(...out.messages);
    allFts.push(...out.fts);
    allToolCalls.push(...out.toolCalls);
    allToolResults.push(...out.toolResults);
    allEvents.push(...out.events);
  }
  if (!firstSession || !firstSession.ok) return;

  const cwd = firstSession.session.cwd;
  const { projectId, worktreeLabel } = classifyCwd(cwd, input.projects);

  input.vault.upsertSession({
    ...firstSession.session,
    project_id: projectId,
    worktree_label: worktreeLabel,
    cwd_exists: existsSync(cwd),
    last_activity: Math.max(firstSession.session.last_activity, fileMtime),
    source: input.source ?? "scan",
    profile,
  });
  input.vault.upsertMessages(allMessages, allFts);
  input.vault.upsertToolCalls(allToolCalls);
  input.vault.applyToolResults(allToolResults);
  input.vault.appendEvents(allEvents);
}
