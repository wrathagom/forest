import { readdirSync } from "node:fs";
import { stat, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { json, notFound, badRequest } from "../server";
import type { Route } from "../server";
import { getProjectById } from "../store/projects";
import { defaultRunGit, type RunGit } from "../git";
import { resolveProjectPath } from "../files/path";
import { parsePorcelainV1Z, type FileStatus } from "../git-status";

export type ProjectFilesDeps = {
  runGit?: RunGit;
};

type TreeEntry = {
  path: string;
  type: "file" | "dir";
  size: number | null;
  gitStatus?: "M" | "A" | "?" | "D" | "R" | "!" | null;
};

const SKIP_DIRS = new Set([".git", "node_modules"]);

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json",
  html: "html", htm: "html",
  css: "css",
  md: "markdown", markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "shell", bash: "shell", zsh: "shell",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sql: "sql",
  dockerfile: "dockerfile",
};

function languageFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith("/dockerfile")) return "dockerfile";
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "plain";
  const ext = lower.slice(dot + 1);
  return LANGUAGE_BY_EXT[ext] ?? "plain";
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export function imageMimeFor(filename: string): string | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

function isBinary(buf: Buffer): boolean {
  const sample = Math.min(buf.length, 8192);
  for (let i = 0; i < sample; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function listTrackedFiles(root: string, run: RunGit): Promise<string[] | null> {
  const r = await run(["ls-files", "--cached", "--others", "--exclude-standard", "--full-name"], root);
  if (r.code !== 0) return null;
  return r.stdout.split("\n").filter(Boolean);
}

type IgnoredEntries = { files: string[]; dirs: string[] };

async function listIgnoredEntries(root: string, run: RunGit): Promise<IgnoredEntries | null> {
  // --directory collapses ignored directories into single entries (trailing /) instead
  // of listing every file inside them — e.g. `node_modules/`, `.venv/`, `dist/`.
  const r = await run(
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--full-name"],
    root,
  );
  if (r.code !== 0) return null;
  const files: string[] = [];
  const dirs: string[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    if (line.endsWith("/")) dirs.push(line.slice(0, -1));
    else files.push(line);
  }
  return { files, dirs };
}

async function probeFileStatuses(
  root: string,
  run: RunGit,
): Promise<Map<string, FileStatus> | null> {
  const r = await run(["status", "--porcelain=v1", "-z"], root);
  if (r.code !== 0) return null;
  return parsePorcelainV1Z(r.stdout);
}

function walkFs(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      // Skip symlinks: cycle risk during walk and ambiguous semantics for the tree
      // (the file's "real" home is wherever the target lives, not where the link sits).
      if (e.isSymbolicLink()) continue;
      if (prefix === "" && e.name.startsWith(".") && e.isDirectory()) continue;
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) {
        walk(join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(root, "");
  return out;
}

// Lists one directory level for lazy expansion of gitignored directories.
// Everything under a gitignored dir is itself ignored from the project repo's
// view, so every child is marked "!" with no git invocation. `.git` (dir or
// worktree file) and symlinks are skipped. Unlike walkFs, node_modules is NOT
// skipped: the user explicitly expanded this dir, so a nested node_modules is
// surfaced as a collapsed entry they can choose to drill into.
async function listDirChildren(absDir: string, rel: string): Promise<TreeEntry[]> {
  let dirents;
  try {
    dirents = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: TreeEntry[] = [];
  for (const e of dirents) {
    if (e.name === ".git") continue;
    if (e.isSymbolicLink()) continue;
    const childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      entries.push({ path: childRel, type: "dir", size: null, gitStatus: "!" });
    } else if (e.isFile()) {
      try {
        const s = await stat(join(absDir, e.name));
        entries.push({ path: childRel, type: "file", size: s.size, gitStatus: "!" });
      } catch {
        // file deleted between readdir and stat
      }
    }
  }
  return entries;
}

async function buildTree(
  files: string[],
  root: string,
  statuses: Map<string, FileStatus> | null,
  ignored: IgnoredEntries,
): Promise<TreeEntry[]> {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  // In practice `ls-files --others --exclude-standard` already surfaces
  // untracked non-ignored files. This is a defensive fold-in for edge cases
  // (e.g., files surfaced by porcelain but absent from ls-files because of
  // submodule or sparse-checkout boundaries).
  if (statuses) {
    const fileSet = new Set(files);
    const extra: string[] = [];
    for (const [p, code] of statuses) {
      if (code === "?" && !fileSet.has(p)) {
        extra.push(p);
        fileSet.add(p);
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      }
    }
    if (extra.length > 0) files = [...files, ...extra];
  }

  // Fold ignored files in. Tracked / status-surfaced files take precedence —
  // we only add ignored entries that aren't already known.
  const knownFiles = new Set(files);
  const ignoredFilesOnly: string[] = [];
  for (const p of ignored.files) {
    if (knownFiles.has(p)) continue;
    ignoredFilesOnly.push(p);
    knownFiles.add(p);
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }

  // Fold ignored directories in as leaves — don't recurse into them. If a tracked
  // path already derived this dir, that wins (the dir has live content elsewhere).
  const trackedDirsSnapshot = new Set(dirs);
  const ignoredDirsOnly: string[] = [];
  for (const p of ignored.dirs) {
    if (trackedDirsSnapshot.has(p)) continue;
    ignoredDirsOnly.push(p);
    // Add proper-prefix parents so the path renders, but not the dir itself —
    // it will be emitted separately with gitStatus "!".
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }

  const entries: TreeEntry[] = [];
  for (const d of dirs) entries.push({ path: d, type: "dir", size: null, gitStatus: null });
  for (const d of ignoredDirsOnly) entries.push({ path: d, type: "dir", size: null, gitStatus: "!" });

  const ignoredFileSet = new Set(ignoredFilesOnly);
  const allFiles = [...files, ...ignoredFilesOnly];

  const fileEntries = await Promise.all(
    allFiles.map(async (f): Promise<TreeEntry | null> => {
      try {
        const s = await stat(join(root, f));
        let gitStatus: TreeEntry["gitStatus"];
        if (ignoredFileSet.has(f)) {
          gitStatus = "!";
        } else {
          gitStatus = statuses ? (statuses.get(f) ?? null) : null;
        }
        return { path: f, type: "file", size: s.size, gitStatus };
      } catch {
        return null; // file deleted between ls and stat
      }
    }),
  );
  for (const e of fileEntries) if (e) entries.push(e);
  return entries;
}

export function projectFilesRoutes(deps: ProjectFilesDeps = {}): Route[] {
  const run = deps.runGit ?? defaultRunGit;
  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/tree$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();

        // ?path=<dir> — lazy one-level listing for expanding a gitignored dir.
        const subPath = ctx.url.searchParams.get("path");
        if (subPath) {
          const abs = resolveProjectPath(project.path, subPath);
          if (!abs) return badRequest("invalid path");
          let st;
          try {
            st = await stat(abs);
          } catch {
            return notFound();
          }
          if (!st.isDirectory()) return notFound();
          return json({ entries: await listDirChildren(abs, subPath) });
        }

        const [tracked, statuses, ignoredEntries] = await Promise.all([
          listTrackedFiles(project.path, run),
          probeFileStatuses(project.path, run),
          listIgnoredEntries(project.path, run),
        ]);
        const files = tracked ?? walkFs(project.path);
        const ignored: IgnoredEntries = ignoredEntries ?? { files: [], dirs: [] };
        return json({ entries: await buildTree(files, project.path, statuses, ignored) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/file$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const rel = ctx.url.searchParams.get("path") ?? "";
        const abs = resolveProjectPath(project.path, rel);
        if (!abs) return badRequest("invalid path");
        let st;
        try {
          st = await stat(abs);
        } catch {
          return notFound();
        }
        if (!st.isFile()) return badRequest("not a file");
        const mtimeMs = st.mtimeMs;
        if (st.size > MAX_TEXT_BYTES) {
          return json({ kind: "too-large", path: rel, size: st.size, mtimeMs });
        }
        const mime = imageMimeFor(rel);
        if (mime) {
          return json({ kind: "image", path: rel, size: st.size, mtimeMs, mime });
        }
        const buf = await readFile(abs);
        if (isBinary(buf)) {
          return json({ kind: "binary", path: rel, size: st.size, mtimeMs });
        }
        const content = buf.toString("utf8");
        const sha = createHash("sha256").update(buf).digest("hex");
        const language = languageFor(rel);
        return json({ kind: "text", path: rel, content, mtimeMs, sha, language });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([^/]+)\/file\/raw$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const rel = ctx.url.searchParams.get("path") ?? "";
        const abs = resolveProjectPath(project.path, rel);
        if (!abs) return badRequest("invalid path");
        let st;
        try {
          st = await stat(abs);
        } catch {
          return notFound();
        }
        if (!st.isFile()) return badRequest("not a file");
        const mime = imageMimeFor(rel) ?? "application/octet-stream";
        // Images load via <img>, which never runs scripts. These headers also
        // neuter the edge case of navigating directly to a raw SVG URL (SVG can
        // embed <script>): nosniff stops MIME guessing, and the CSP blocks any
        // script execution if the bytes are ever rendered as a top-level document.
        return new Response(Bun.file(abs), {
          headers: {
            "content-type": mime,
            "x-content-type-options": "nosniff",
            "content-security-policy": "script-src 'none'; sandbox",
          },
        });
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/projects\/([^/]+)\/file$/,
      paramNames: ["id"],
      handler: async (ctx) => {
        const project = getProjectById(ctx.db, ctx.params.id!);
        if (!project) return notFound();
        const rel = ctx.url.searchParams.get("path") ?? "";
        const abs = resolveProjectPath(project.path, rel);
        if (!abs) return badRequest("invalid path");
        const body = (await ctx.request.json().catch(() => null)) as
          | { content?: string; expectedMtimeMs?: number }
          | null;
        if (!body || typeof body.content !== "string") return badRequest("content is required");

        if (typeof body.expectedMtimeMs === "number") {
          let cur;
          try {
            cur = await stat(abs);
          } catch {
            cur = null; // file doesn't exist yet, no conflict possible
          }
          // Strict > here means same-second modifications on coarse-mtime filesystems
          // (e.g. HFS+ with 1s granularity) won't trigger a conflict. The client may
          // also send the SHA in a future iteration to disambiguate.
          if (cur && cur.mtimeMs > body.expectedMtimeMs) {
            const curBuf = await readFile(abs);
            const currentSha = createHash("sha256").update(curBuf).digest("hex");
            return json({ error: "stale", currentMtimeMs: cur.mtimeMs, currentSha }, { status: 409 });
          }
        }

        const tmp = `${abs}.forest-tmp.${crypto.randomUUID()}`;
        try {
          await writeFile(tmp, body.content);
          await rename(tmp, abs);
        } catch (err) {
          try { await unlink(tmp); } catch { /* ignore */ }
          return json({ error: `write failed: ${(err as Error).message}` }, { status: 500 });
        }
        const st = await stat(abs);
        const sha = createHash("sha256").update(body.content).digest("hex");
        return json({ path: rel, mtimeMs: st.mtimeMs, sha });
      },
    },
  ];
}
