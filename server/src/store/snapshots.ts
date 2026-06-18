import type { Database } from "bun:sqlite";
import type { Snapshot } from "../scanner/types";

export type StoredSnapshot = { projectId: string; scannedAt: number; snapshot: Snapshot };

export function upsertSnapshot(db: Database, projectId: string, snapshot: Snapshot): void {
  db.query(
    `INSERT INTO snapshots (project_id, scanned_at, payload)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET scanned_at = excluded.scanned_at, payload = excluded.payload`
  ).run(projectId, Date.now(), JSON.stringify(snapshot));
}

export function getSnapshotByProjectId(
  db: Database,
  projectId: string
): StoredSnapshot | undefined {
  const row = db
    .query<{ project_id: string; scanned_at: number; payload: string }, [string]>(
      "SELECT * FROM snapshots WHERE project_id = ?"
    )
    .get(projectId);
  if (!row) return undefined;
  return {
    projectId: row.project_id,
    scannedAt: row.scanned_at,
    snapshot: JSON.parse(row.payload) as Snapshot,
  };
}

export function listLatestSnapshots(db: Database): StoredSnapshot[] {
  return db
    .query<{ project_id: string; scanned_at: number; payload: string }, []>(
      "SELECT * FROM snapshots"
    )
    .all()
    .map((row) => ({
      projectId: row.project_id,
      scannedAt: row.scanned_at,
      snapshot: JSON.parse(row.payload) as Snapshot,
    }));
}
