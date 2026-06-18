import type { Database } from "bun:sqlite";

/** Persistent record of sessions the user marked "done" from the mobile UI. */
export interface DismissalStore {
  /** All dismissals as [sessionId, dismissedAt] pairs. */
  load(): Array<[string, number]>;
  put(sessionId: string, dismissedAt: number): void;
  delete(sessionId: string): void;
}

export function makeDismissalStore(db: Database): DismissalStore {
  return {
    load: () =>
      db
        .query<{ session_id: string; dismissed_at: number }, []>(
          "SELECT session_id, dismissed_at FROM agent_session_dismissals",
        )
        .all()
        .map((r) => [r.session_id, r.dismissed_at] as [string, number]),
    put: (sessionId, dismissedAt) =>
      db
        .query(
          `INSERT INTO agent_session_dismissals (session_id, dismissed_at) VALUES (?, ?)
             ON CONFLICT(session_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
        )
        .run(sessionId, dismissedAt),
    delete: (sessionId) =>
      db.query("DELETE FROM agent_session_dismissals WHERE session_id = ?").run(sessionId),
  };
}
