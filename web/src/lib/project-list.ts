import type { ProjectRow } from "../api";

export type ProjectSort = "recent" | "running" | "name";

/** Most recent activity timestamp: newest of last file edit and last git commit. Returns 0 when the project has never been scanned (no snapshot). */
export function lastActivity(p: ProjectRow): number {
  const edit = p.snapshot?.lastEdit ?? 0;
  const commit = p.snapshot?.git.lastCommit?.timestamp ?? 0;
  return Math.max(edit, commit);
}

/** Returns a new array sorted by the given key; never mutates the input. */
export function sortProjects(list: ProjectRow[], sort: ProjectSort): ProjectRow[] {
  const copy = [...list];
  if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else if (sort === "running") {
    copy.sort((a, b) => b.liveSessions - a.liveSessions || lastActivity(b) - lastActivity(a));
  } else {
    copy.sort((a, b) => {
      const aLive = a.liveSessions > 0 ? 1 : 0;
      const bLive = b.liveSessions > 0 ? 1 : 0;
      return bLive - aLive || lastActivity(b) - lastActivity(a);
    });
  }
  return copy;
}

export function matchesQuery(p: ProjectRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return p.name.toLowerCase().includes(q);
}

/** Merge visible + archived, keep name matches, and sort. Used while searching. */
export function searchProjects(
  visible: ProjectRow[],
  archived: ProjectRow[],
  query: string,
  sort: ProjectSort,
): ProjectRow[] {
  const merged = [...visible, ...archived].filter((p) => matchesQuery(p, query));
  return sortProjects(merged, sort);
}
