import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export type Project = {
  id: string;
  path: string;
  name: string;
  pinned: boolean;
  hidden: boolean;
  group: string | null;
  lifecycleEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  path: string;
  name: string;
  pinned: number;
  hidden: number;
  group_name: string | null;
  lifecycle_enabled: number;
  created_at: number;
  updated_at: number;
};

export function hashPath(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

const fromRow = (r: Row): Project => ({
  id: r.id,
  path: r.path,
  name: r.name,
  pinned: r.pinned === 1,
  hidden: r.hidden === 1,
  group: r.group_name,
  lifecycleEnabled: r.lifecycle_enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function upsertProject(
  db: Database,
  input: { path: string; name: string; group?: string | null }
): string {
  const id = hashPath(input.path);
  const now = Date.now();
  // Backfill group_name on conflict if and only if it is currently null,
  // so users keep manual groupings but auto-inferred groups still fill in
  // for projects that didn't have one yet.
  db.query(
    `INSERT INTO projects (id, path, name, group_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       group_name = COALESCE(group_name, excluded.group_name),
       updated_at = excluded.updated_at`
  ).run(id, input.path, input.name, input.group ?? null, now, now);
  return id;
}

export function getProjectById(db: Database, id: string): Project | undefined {
  const row = db.query<Row, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? fromRow(row) : undefined;
}

export function getProjectByPath(db: Database, path: string): Project | undefined {
  const row = db
    .query<Row, [string]>("SELECT * FROM projects WHERE path = ?")
    .get(path);
  return row ? fromRow(row) : undefined;
}

export type ProjectListView = "default" | "archived" | "all";

export function listProjects(db: Database, view: ProjectListView = "default"): Project[] {
  const where = view === "archived" ? "WHERE hidden = 1" : view === "all" ? "" : "WHERE hidden = 0";
  return db
    .query<Row, []>(
      `SELECT * FROM projects ${where}
       ORDER BY pinned DESC, name COLLATE NOCASE ASC`,
    )
    .all()
    .map(fromRow);
}

// Backwards-compatible alias for existing callers (loop, routes).
export function listVisibleProjects(db: Database): Project[] {
  return listProjects(db, "default");
}

export type ProjectPatch = {
  pinned?: boolean;
  hidden?: boolean;
  name?: string;
  group?: string | null;
  lifecycleEnabled?: boolean;
};

export function updateProject(db: Database, id: string, patch: ProjectPatch): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.pinned !== undefined) {
    sets.push("pinned = ?");
    args.push(patch.pinned ? 1 : 0);
  }
  if (patch.hidden !== undefined) {
    sets.push("hidden = ?");
    args.push(patch.hidden ? 1 : 0);
  }
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.group !== undefined) {
    sets.push("group_name = ?");
    args.push(patch.group);
  }
  if (patch.lifecycleEnabled !== undefined) {
    sets.push("lifecycle_enabled = ?");
    args.push(patch.lifecycleEnabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(Date.now());
  args.push(id);
  db.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...(args as never[]));
}

export function deleteProjectById(db: Database, id: string): void {
  db.query("DELETE FROM projects WHERE id = ?").run(id);
}

export class ProjectPathConflictError extends Error {
  constructor(public readonly path: string) {
    super(`a project already exists at ${path}`);
    this.name = "ProjectPathConflictError";
  }
}

// Re-key a project to a new path. Because a project's id is a hash of its path
// (see hashPath) and foreign keys are enforced, we insert the new row, repoint
// every child table, then delete the old row — all in one transaction. Ordered
// this way the new parent always exists before a child points at it, and the
// old parent has no children when it is deleted, so neither CASCADE nor
// SET NULL fires.
export function relocateProject(db: Database, oldId: string, newPath: string): string {
  const newId = hashPath(newPath);
  if (newId === oldId) return oldId; // path hash unchanged — nothing to move
  if (getProjectById(db, newId)) throw new ProjectPathConflictError(newPath);
  const project = getProjectById(db, oldId);
  if (!project) throw new Error(`no project with id ${oldId}`);
  const now = Date.now();
  db.transaction(() => {
    db.query(
      `INSERT INTO projects
         (id, path, name, pinned, hidden, group_name, lifecycle_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId,
      newPath,
      project.name,
      project.pinned ? 1 : 0,
      project.hidden ? 1 : 0,
      project.group,
      project.lifecycleEnabled ? 1 : 0,
      project.createdAt,
      now,
    );
    db.query(`UPDATE snapshots SET project_id = ? WHERE project_id = ?`).run(newId, oldId);
    db.query(`UPDATE agent_sessions SET project_id = ? WHERE project_id = ?`).run(newId, oldId);
    db.query(`UPDATE tasks SET project_id = ? WHERE project_id = ?`).run(newId, oldId);
    db.query(`DELETE FROM projects WHERE id = ?`).run(oldId);
  })();
  return newId;
}
