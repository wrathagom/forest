export type FileDiff = {
  /** Display path, e.g. "web/src/components/TaskView.tsx". */
  path: string;
  /** Count of added lines (lines starting with "+", excluding "+++"). */
  adds: number;
  /** Count of deleted lines (lines starting with "-", excluding "---"). */
  dels: number;
  /** The raw diff lines for this file, including its `diff --git` header. */
  lines: string[];
};

function pathFromDiffGit(line: string): string {
  // "diff --git a/foo/bar b/foo/bar" -> "foo/bar"
  const m = line.match(/ b\/(.+)$/);
  return m ? m[1]! : line.slice("diff --git ".length);
}

function pathFromHeader(line: string): string | null {
  // "+++ b/foo/bar" -> "foo/bar"; "+++ /dev/null" -> null (deleted file)
  const p = line.slice(4).trim();
  if (p === "/dev/null") return null;
  return p.startsWith("b/") ? p.slice(2) : p;
}

/** Split a unified-diff string into one {@link FileDiff} per file. */
export function parseDiffFiles(diff: string | null): FileDiff[] {
  const text = diff ?? "";
  if (!text.trim()) return [];

  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { path: pathFromDiffGit(line), adds: 0, dels: 0, lines: [line] };
      files.push(current);
      continue;
    }
    if (!current) {
      // Headerless diff: synthesize one group so no line is dropped.
      current = { path: "(diff)", adds: 0, dels: 0, lines: [] };
      files.push(current);
    }
    current.lines.push(line);

    if (line.startsWith("+++ ")) {
      const p = pathFromHeader(line);
      if (p) current.path = p;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.adds++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.dels++;
    }
  }
  return files;
}
