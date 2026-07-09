export type ProjectListResponse = {
  projects: ProjectRow[];
  scanRoot: string | null;
  pollIntervalMs: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  path: string;
  pinned: boolean;
  hidden: boolean;
  group: string | null;
  snapshot: Snapshot | null;
  scannedAt: number | null;
  liveSessions: number;
  liveAgents: { agent: string; count: number }[];
};

export type Snapshot = {
  git: {
    branch: string | null;
    dirty: boolean;
    changed: number;
    ahead: number;
    behind: number;
    lastCommit: { sha: string; message: string; timestamp: number } | null;
  };
  lastEdit: number | null;
  services: {
    docker: { name: string; state: "running" | "stopped"; from: "compose" }[];
    processes: { pid: number; command: string; cwd: string; ports: number[] }[];
  };
  errors: string[];
};

async function unwrap<T>(r: Response, label: string): Promise<T> {
  if (r.ok) {
    // 204 / empty body (e.g. the reply + done endpoints) — nothing to parse.
    if (r.status === 204 || r.headers.get("content-length") === "0") return undefined as T;
    return r.json() as Promise<T>;
  }
  let detail = `${label}: ${r.status}`;
  try {
    const body = await r.json();
    if (body && typeof body.error === "string") detail = body.error;
  } catch {
    // body wasn't JSON; keep the status-based message
  }
  throw new Error(detail);
}

export type ProjectView = "default" | "archived" | "all";

export async function fetchProjects(view: ProjectView = "default"): Promise<ProjectListResponse> {
  const qs = view === "default" ? "" : `?view=${view}`;
  return unwrap<ProjectListResponse>(await fetch(`/api/projects${qs}`), "fetch projects");
}

export async function refreshProject(id: string): Promise<{ id: string; snapshot: Snapshot; scannedAt: number }> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(id)}/refresh`, { method: "POST" }), "refresh");
}

export async function patchProject(id: string, patch: { pinned?: boolean; hidden?: boolean; name?: string; group?: string | null }) {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "patch project",
  );
}

export async function fetchConfig() {
  return unwrap<{
    scanRoot: string | null;
    pollIntervalMs: number;
    sessionMaxTotal?: number;
    sessionMaxScrollbackLines?: number;
    sessionDefaultShell?: string;
    projectSubdirs?: string[];
    launchers?: Array<{
      id: string;
      label: string;
      command: string | null;
      args: string[];
      agent?: string;
    }>;
    claudeConfigDirs?: Array<{ path: string; profile: string }>;
  }>(await fetch("/api/config"), "config");
}

export async function patchConfig(patch: {
  scanRoot?: string;
  pollIntervalMs?: number;
  sessionMaxTotal?: number;
  sessionMaxScrollbackLines?: number;
  sessionDefaultShell?: string;
  projectSubdirs?: string[];
  launchers?: Array<{
    id: string;
    label: string;
    command: string | null;
    args: string[];
    agent?: string;
  }>;
}) {
  return unwrap(
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "config patch",
  );
}

export async function runDiscover(): Promise<{ ok: boolean; root?: string; count?: number }> {
  return unwrap(await fetch("/api/discover", { method: "POST" }), "discover");
}

export type SessionRow = {
  id: string;
  projectId: string;
  cwd: string;
  command: string;
  args: string[];
  createdAt: number;
  launcher: { id: string; agent?: string } | null;
  agent: string | null;
};

export async function listSessions(projectId: string): Promise<SessionRow[]> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`), "sessions");
}

export async function createSession(
  projectId: string,
  body: { cwd?: string; command?: string; args?: string[]; cols: number; rows: number; launcherId?: string },
): Promise<SessionRow> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "create session",
  );
}

export async function killSession(sessionId: string): Promise<void> {
  await unwrap(
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
    "kill session",
  );
}

export type ProcessDetail = {
  pid: number;
  ppid: number;
  command: string;
  cwd: string;
  user: string;
  cpu: number;
  memMB: number;
  startedAt: number;
  ports: number[];
};

export type ContainerDetail = {
  service: string;
  state: "running" | "exited" | "stopped" | "paused" | "unknown";
  containerName: string;
  image: string;
  ports: { host: string; container: number; protocol: "tcp" | "udp" }[];
  startedAt: number | null;
  exitCode: number | null;
  health: "healthy" | "unhealthy" | "starting" | null;
};

export async function listProcessDetail(projectId: string): Promise<ProcessDetail[]> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(projectId)}/processes`), "processes");
}

export async function listContainerDetail(projectId: string): Promise<ContainerDetail[]> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(projectId)}/containers`), "containers");
}

export async function createProject(body: {
  name: string;
  subdir: string;
  source: { type: "blank" } | { type: "clone"; url: string };
}): Promise<{ project: ProjectRow }> {
  return unwrap(
    await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "create project",
  );
}

export type GitFileStatus = "M" | "A" | "?" | "D" | "R" | "!";

export type TreeEntry = {
  path: string;
  type: "file" | "dir";
  size: number | null;
  gitStatus?: GitFileStatus | null;
};

export type FileResponse =
  | { kind: "text"; path: string; content: string; mtimeMs: number; sha: string; language: string }
  | { kind: "image"; path: string; size: number; mtimeMs: number; mime: string }
  | { kind: "binary"; path: string; size: number; mtimeMs: number }
  | { kind: "too-large"; path: string; size: number; mtimeMs: number };

export type FileWriteResponse = { path: string; mtimeMs: number; sha: string };

export type FileWriteStale = { error: "stale"; currentMtimeMs: number; currentSha: string };

export async function fetchTree(projectId: string): Promise<{ entries: TreeEntry[] }> {
  return unwrap(await fetch(`/api/projects/${encodeURIComponent(projectId)}/tree`), "tree");
}

export async function fetchTreeChildren(
  projectId: string,
  path: string,
): Promise<{ entries: TreeEntry[] }> {
  return unwrap(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/tree?path=${encodeURIComponent(path)}`,
    ),
    "tree children",
  );
}

export async function fetchFile(projectId: string, path: string): Promise<FileResponse> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`),
    "file",
  );
}

export function fileRawUrl(projectId: string, path: string, version: number): string {
  return `/api/projects/${encodeURIComponent(projectId)}/file/raw?path=${encodeURIComponent(path)}&v=${version}`;
}

export async function writeFile(
  projectId: string,
  path: string,
  body: { content: string; expectedMtimeMs?: number },
): Promise<FileWriteResponse | FileWriteStale> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 409) {
    return (await r.json()) as FileWriteStale;
  }
  return unwrap(r, "file write");
}

export type GitLogCommit = {
  sha: string;
  subject: string;
  author: string;
  timestamp: number;
};

export type GitLogResponse = {
  commits: GitLogCommit[];
  hasMore: boolean;
};

export async function fetchGitLog(
  projectId: string,
  opts: { limit?: number; before?: string; ref?: string } = {},
): Promise<GitLogResponse> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.before) qs.set("before", opts.before);
  if (opts.ref) qs.set("ref", opts.ref);
  const q = qs.toString();
  return unwrap(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/git/log${q ? `?${q}` : ""}`,
    ),
    "git log",
  );
}

export type GitBranch = {
  name: string;
  isCurrent: boolean;
  ahead: number;
  behind: number;
  hasWorktree: boolean;
  worktreePath: string | null;
  dirty: boolean | null;
  lastCommit: number;
};

export type GitBranchesResponse = {
  base: string;
  branches: GitBranch[];
};

export async function fetchGitBranches(
  projectId: string,
): Promise<GitBranchesResponse> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/branches`),
    "git branches",
  );
}

export type GitDiffResponse = {
  path: string;
  diff: string;
  status: GitFileStatus | null;
};

export async function fetchGitDiff(
  projectId: string,
  path: string,
): Promise<GitDiffResponse> {
  return unwrap(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/git/diff?path=${encodeURIComponent(path)}`,
    ),
    "git diff",
  );
}

export type GitCommitResponse = {
  sha: string;
  parents: string[];
  author: string;
  timestamp: number;
  message: string;
  diff: string;
};

export async function fetchGitCommit(
  projectId: string,
  sha: string,
): Promise<GitCommitResponse> {
  return unwrap(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/git/commit?sha=${encodeURIComponent(sha)}`,
    ),
    "git commit",
  );
}

export type AgentSessionRow = {
  session_id: string;
  agent: string;
  project_id: string | null;
  cwd: string;
  worktree_label: string | null;
  branch: string | null;
  cwd_exists: number;
  parent_session_id: string | null;
  started_at: number | null;
  last_activity: number;
  message_count: number;
  first_user_msg: string | null;
  profile: string | null;
  snippet?: string;
};

export type AgentSessionDetail = {
  session: AgentSessionRow;
  messages: Array<{
    id: number;
    role: string;
    content: string;
    timestamp: number;
    model: string | null;
    input_tokens: number | null;
    cache_create_tokens: number | null;
    cache_read_tokens: number | null;
    output_tokens: number | null;
    stop_reason: string | null;
  }>;
  toolCalls: Array<{
    id: number;
    tool_use_id: string;
    tool_name: string;
    tool_input: string | null;
    started_at: number;
    finished_at: number | null;
    duration_ms: number | null;
    result_status: string | null;
    result_size: number | null;
  }>;
  events: Array<{ id: number; kind: string; timestamp: number; payload: string | null }>;
};

export async function listAgentSessions(
  projectId: string,
  opts?: { q?: string; limit?: number; offset?: number },
): Promise<{ sessions: AgentSessionRow[] }> {
  const sp = new URLSearchParams();
  if (opts?.q) sp.set("q", opts.q);
  if (opts?.limit !== undefined) sp.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) sp.set("offset", String(opts.offset));
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent-sessions?${sp}`),
    "agent sessions",
  );
}

export async function getAgentSessionDetail(sessionId: string): Promise<AgentSessionDetail> {
  return unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`),
    "agent session detail",
  );
}

export type PrepareResumeResult =
  | { status: "noop" }
  | { status: "present"; path: string }
  | { status: "copied"; from: string; to: string };

/**
 * Ensure `sessionId` can be resumed from `cwd`. Claude looks up `--resume <id>`
 * only under the current cwd's transcript dir, so a session recorded in a
 * deleted worktree needs its transcript copied across first. Idempotent.
 */
export async function prepareResume(sessionId: string, cwd: string): Promise<PrepareResumeResult> {
  return unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/prepare-resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    }),
    "prepare resume",
  );
}

export async function createWorktree(
  projectId: string,
  body: { branch: string; name: string },
): Promise<{ path: string }> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/worktrees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "create worktree",
  );
}

export type SessionListRow = {
  session_id: string;
  agent: string;
  project_id: string | null;
  project_name: string | null;
  cwd: string;
  worktree_label: string | null;
  branch: string | null;
  profile: string | null;
  cwd_exists: number;
  parent_session_id: string | null;
  started_at: number | null;
  last_activity: number;
  message_count: number;
  first_user_msg: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  snippet?: string;
};

export type SessionsSort = "last_activity" | "started_at" | "tokens" | "message_count" | "project" | "profile";

export type SessionsOverviewResponse = { sessions: SessionListRow[]; total: number };

export async function fetchSessionsOverview(opts: {
  q?: string;
  project?: string;
  profile?: string;
  sort?: SessionsSort;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}): Promise<SessionsOverviewResponse> {
  const sp = new URLSearchParams();
  if (opts.q) sp.set("q", opts.q);
  if (opts.project) sp.set("project", opts.project);
  if (opts.profile) sp.set("profile", opts.profile);
  if (opts.sort) sp.set("sort", opts.sort);
  if (opts.dir) sp.set("dir", opts.dir);
  if (opts.limit !== undefined) sp.set("limit", String(opts.limit));
  if (opts.offset !== undefined) sp.set("offset", String(opts.offset));
  return unwrap(await fetch(`/api/sessions?${sp}`), "sessions overview");
}

export type TokenBucket = { input: number; output: number; cache: number };
export type TokensOverTimePoint = TokenBucket & { day: string; byProfile: Record<string, number> };
export type TokensByProjectRow = TokenBucket & { projectId: string | null; projectName: string; sessions: number };
export type TokensByProfileRow = TokenBucket & { profile: string; sessions: number };

export type SessionsStatsResponse = {
  tokensOverTime: TokensOverTimePoint[];
  tokensByProject: TokensByProjectRow[];
  tokensByProfile: TokensByProfileRow[];
  profiles: string[];
  totals: TokenBucket & { sessions: number };
};

export async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  return unwrap(await fetch("/api/sessions/stats"), "sessions stats");
}

export type LiveSessionState = "working" | "waiting" | "stale";

export type LiveSessionRow = {
  agentSessionId: string;
  parentSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  cwd: string;
  worktreeLabel: string | null;
  branch: string | null;
  profile: string | null;
  ptySessionId: string | null;
  state: LiveSessionState;
  endedAt: number | null;
  startedAt: number;
  lastEventAt: number;
  lastUserMsg: string | null;
};

export async function fetchLiveSessions(): Promise<{ sessions: LiveSessionRow[] }> {
  return unwrap(await fetch("/api/agent-sessions/live"), "live sessions");
}

export type MobilePermissionMode = "plan" | "acceptEdits" | "bypassPermissions";

export type MobileListItem = {
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  label: string;
  snippet: string | null;
  state: "working" | "waiting" | "done";
  lastActivity: number;
  launchedVia: "mobile" | null;
  forestActionable: boolean;
};

export type MobileSessionsResponse = {
  needsYou: MobileListItem[];
  working: MobileListItem[];
  recent: MobileListItem[];
};

export async function fetchMobileSessions(): Promise<MobileSessionsResponse> {
  return unwrap(await fetch("/api/m/sessions"), "mobile sessions");
}

export async function launchAgentRun(body: {
  projectId: string;
  prompt: string;
  permissionMode: MobilePermissionMode;
}): Promise<{ sessionId: string }> {
  return unwrap(
    await fetch("/api/agent-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "launch agent run",
  );
}

export async function replyToSession(sessionId: string, text: string): Promise<void> {
  await unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
    "reply",
  );
}

export async function markSessionDone(sessionId: string): Promise<void> {
  await unwrap(
    await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/done`, { method: "POST" }),
    "mark session done",
  );
}

export type TaskStatus = "draft" | "running" | "review" | "done" | "abandoned";
export type TaskResult = "merged" | "pr" | "detached" | "discarded";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  intent: string;
  status: TaskStatus;
  baseBranch: string;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  ptySessionId: string | null;
  result: TaskResult | null;
  resultRef: string | null;
  createdAt: number;
  updatedAt: number;
  launchedAt: number | null;
};

export async function listTasks(projectId: string): Promise<{ tasks: Task[] }> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`),
    "tasks",
  );
}

export async function getTaskDetail(taskId: string): Promise<{ task: Task; diff: string | null }> {
  return unwrap(
    await fetch(`/api/tasks/${encodeURIComponent(taskId)}`),
    "task detail",
  );
}

export async function createTask(
  projectId: string,
  body: { intent: string; baseBranch?: string; status?: "running" },
): Promise<{ task: Task }> {
  return unwrap(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "create task",
  );
}

export async function patchTask(
  taskId: string,
  body: { status: TaskStatus; result?: TaskResult },
): Promise<{ task: Task }> {
  return unwrap(
    await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "update task",
  );
}

export async function deleteTask(taskId: string): Promise<void> {
  await unwrap(
    await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),
    "delete task",
  );
}

export type CaffeinateStatus = {
  supported: boolean;
  active: boolean;
  endsAt: number | null;
  indefinite: boolean;
};

export async function fetchCaffeinateStatus(): Promise<CaffeinateStatus> {
  return unwrap<CaffeinateStatus>(await fetch("/api/caffeinate"), "fetch caffeinate status");
}

export async function startCaffeinate(durationSec: number | null): Promise<CaffeinateStatus> {
  return unwrap<CaffeinateStatus>(
    await fetch("/api/caffeinate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ durationSec }),
    }),
    "start caffeinate",
  );
}

export async function stopCaffeinate(): Promise<CaffeinateStatus> {
  return unwrap<CaffeinateStatus>(
    await fetch("/api/caffeinate", { method: "DELETE" }),
    "stop caffeinate",
  );
}

export type BbsConfigResponse = {
  enabled: boolean;
  baseUrl: string;
  screenId: string | null;
  screenUrl: string | null;
  accountKey: string | null;
  screenKey: string | null;
  alertLingerSec: number;
  hudIntervalMs: number;
  rotationIntervalSec: number;
  hudPanelCap: number;
  alertEvents: string[];
  status: { lastOk: number | null; lastError: string | null };
};

export async function fetchBbsConfig() {
  return unwrap<BbsConfigResponse>(await fetch("/api/bbs/config"), "bbs config");
}

export async function saveBbsConfig(patch: Record<string, unknown>) {
  return unwrap<{ ok: boolean }>(
    await fetch("/api/bbs/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
    "save bbs config",
  );
}

export async function provisionBbs() {
  return unwrap<{ ok: boolean; screenId: string; screenUrl: string }>(
    await fetch("/api/bbs/provision", { method: "POST" }),
    "provision bbs",
  );
}

export async function testBbs() {
  return unwrap<{ ok: boolean }>(await fetch("/api/bbs/test", { method: "POST" }), "test bbs");
}
