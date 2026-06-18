export type FileStatus = "M" | "A" | "?" | "D" | "R";

/**
 * Parse the output of `git status --porcelain=v1 -z`.
 *
 * Format notes:
 *   - Records are NUL-terminated (no separator between records — each record ends with \0).
 *   - Each record starts with two status chars `XY`, then a single space, then the path.
 *   - Renames split across two records: "R  <to-path>\0<from-path>\0".
 *
 * We collapse the (X,Y) pair to a single UI badge:
 *   ??  -> "?"   (untracked)
 *   R*  -> "R"   (renamed; we report the destination path)
 *   A*  -> "A"   (added/staged)
 *   *D  -> "D"   (deleted in either side)
 *   else -> "M"  (anything else with content change)
 */
export function parsePorcelainV1Z(stdout: string): Map<string, FileStatus> {
  const map = new Map<string, FileStatus>();
  const tokens = stdout.split("\0");
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.length < 3) {
      // Empty trailing token, or malformed — skip.
      i += 1;
      continue;
    }
    const x = tok[0]!;
    const y = tok[1]!;
    const path = tok.slice(3); // skip "XY "

    let status: FileStatus;
    if (x === "?" && y === "?") {
      status = "?";
    } else if (x === "R") {
      status = "R";
      // Consume the from-path token so it doesn't get treated as a separate record.
      i += 1;
    } else if (x === "A") {
      status = "A";
    } else if (x === "D" || y === "D") {
      status = "D";
    } else {
      status = "M";
    }

    map.set(path, status);
    i += 1;
  }
  return map;
}
