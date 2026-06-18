import { realpathSync, existsSync } from "node:fs";
import { resolve, sep, relative, isAbsolute } from "node:path";

export function resolveProjectPath(projectRoot: string, rel: string): string | null {
  if (rel.length === 0) return null;
  if (isAbsolute(rel)) return null;
  // Reject Windows-style absolute (drive letter) paths defensively, even on macOS.
  if (/^[A-Za-z]:[/\\]/.test(rel)) return null;

  const resolved = resolve(projectRoot, rel);
  const rootWithSep = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) return null;

  // Walk each path component from root to leaf. For each prefix that exists,
  // realpath it and confirm it stays within realpathSync(projectRoot).
  // This catches directory symlinks that could redirect a non-existent leaf outside the root.
  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    return null;
  }
  const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

  const parts = relative(projectRoot, resolved).split(sep).filter(Boolean);
  let cursor = projectRoot;
  for (let i = 0; i < parts.length; i++) {
    cursor = resolve(cursor, parts[i]);
    if (existsSync(cursor)) {
      let realCursor: string;
      try {
        realCursor = realpathSync(cursor);
      } catch {
        return null;
      }
      if (realCursor !== realRoot && !realCursor.startsWith(realRootWithSep)) return null;
    } else {
      // This component doesn't exist; neither will subsequent ones.
      // The lexical check above already ensures containment — stop walking.
      break;
    }
  }

  return resolved;
}
