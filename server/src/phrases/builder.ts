import type { Database } from "bun:sqlite";
import { getConfig, setConfig } from "../store/config";
import { extractPhrases, monthOf } from "./tokenize";

export type BuilderOpts = {
  minTotal?: number;    // drop phrases whose all-time total is below this
  batchSize?: number;   // messages processed per event-loop yield
  nMin?: number;
  nMax?: number;
  staleHours?: number;      // rebuild if the index is older than this
  staleNewMsgs?: number;    // rebuild if this many new assistant messages arrived
};

export type PhraseStatus = {
  lastBuiltAt: number | null;
  rowCount: number;
  building: boolean;
  staleNewMsgs: number;
};

export const AGENT = "claude"; // MVP: Claude only. Codex reuses this builder later.

// Intended to be constructed once and held for the life of the process (e.g.
// a singleton on app startup). The `building` guard is per-instance state, so
// multiple instances would not see each other's in-flight rebuild.
export class PhraseIndexBuilder {
  private building = false;
  private readonly minTotal: number;
  private readonly batchSize: number;
  private readonly nMin: number;
  private readonly nMax: number;
  private readonly staleHours: number;
  private readonly staleThreshold: number;

  constructor(private readonly db: Database, opts: BuilderOpts = {}) {
    this.minTotal = opts.minTotal ?? 5;
    this.batchSize = opts.batchSize ?? 500;
    this.nMin = opts.nMin ?? 2;
    this.nMax = opts.nMax ?? 5;
    this.staleHours = opts.staleHours ?? 12;
    this.staleThreshold = opts.staleNewMsgs ?? 2000;
  }

  isBuilding(): boolean {
    return this.building;
  }

  private builtThroughMsgId(): number {
    return parseInt(getConfig(this.db, "phrases.builtThroughMsgId") ?? "0", 10) || 0;
  }

  private newMsgCount(): number {
    return (
      this.db
        .query<{ n: number }, [string, number]>(
          `SELECT COUNT(*) AS n
             FROM agent_messages m JOIN agent_sessions s ON s.session_id = m.session_id
            WHERE m.role = 'assistant' AND s.agent = ? AND m.id > ?`,
        )
        .get(AGENT, this.builtThroughMsgId())?.n ?? 0
    );
  }

  status(): PhraseStatus {
    const lastBuiltRaw = getConfig(this.db, "phrases.lastBuiltAt");
    const rowCount = parseInt(getConfig(this.db, "phrases.rowCount") ?? "0", 10) || 0;
    return {
      lastBuiltAt: lastBuiltRaw ? parseInt(lastBuiltRaw, 10) : null,
      rowCount,
      building: this.building,
      staleNewMsgs: this.newMsgCount(),
    };
  }

  isStale(): boolean {
    const lastBuiltRaw = getConfig(this.db, "phrases.lastBuiltAt");
    if (!lastBuiltRaw) return true;
    const ageMs = Date.now() - (parseInt(lastBuiltRaw, 10) || 0);
    if (ageMs > this.staleHours * 3_600_000) return true;
    return this.newMsgCount() >= this.staleThreshold;
  }

  /** Full rebuild. Cooperative: yields to the event loop between batches so the
   *  single-threaded server keeps serving requests. Concurrent calls are no-ops. */
  async rebuild(): Promise<void> {
    if (this.building) return;
    this.building = true;
    try {
      const db = this.db;
      db.exec("DROP TABLE IF EXISTS agent_ngrams_build");
      db.exec(
        `CREATE TABLE agent_ngrams_build (
           agent TEXT NOT NULL, n INTEGER NOT NULL, phrase TEXT NOT NULL,
           month TEXT NOT NULL, count INTEGER NOT NULL,
           PRIMARY KEY (agent, n, phrase, month)
         )`,
      );
      const upsert = db.query(
        `INSERT INTO agent_ngrams_build (agent, n, phrase, month, count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent, n, phrase, month) DO UPDATE SET count = count + excluded.count`,
      );
      const select = db.query<{ id: number; content: string; timestamp: number }, [string, number, number]>(
        `SELECT m.id, m.content, m.timestamp
           FROM agent_messages m JOIN agent_sessions s ON s.session_id = m.session_id
          WHERE m.role = 'assistant' AND s.agent = ? AND m.id > ?
          ORDER BY m.id ASC
          LIMIT ?`,
      );

      let lastId = 0;
      let maxId = 0;
      for (;;) {
        const batch = select.all(AGENT, lastId, this.batchSize);
        if (batch.length === 0) break;
        // Accumulate this batch in a local map to bound memory, then flush.
        const local = new Map<string, { n: number; phrase: string; month: string; count: number }>();
        for (const row of batch) {
          lastId = row.id;
          maxId = row.id;
          const month = monthOf(row.timestamp);
          for (const { n, phrase } of extractPhrases(row.content, { nMin: this.nMin, nMax: this.nMax })) {
            const key = `${n}|${month}|${phrase}`;
            const e = local.get(key);
            if (e) e.count++;
            else local.set(key, { n, phrase, month, count: 1 });
          }
        }
        const flush = db.transaction(() => {
          for (const e of local.values()) upsert.run(AGENT, e.n, e.phrase, e.month, e.count);
        });
        flush();
        await new Promise((r) => setTimeout(r, 0)); // yield between batches
      }

      // Compact (threshold) + swap into the live table atomically. The live
      // table and its index are preserved; only its rows are replaced.
      const swap = db.transaction(() => {
        db.exec("DELETE FROM agent_ngrams");
        db.query(
          `INSERT INTO agent_ngrams (agent, n, phrase, month, count)
             SELECT b.agent, b.n, b.phrase, b.month, b.count
               FROM agent_ngrams_build b
               JOIN (SELECT agent, n, phrase FROM agent_ngrams_build
                      GROUP BY agent, n, phrase HAVING SUM(count) >= ?) k
                 ON k.agent = b.agent AND k.n = b.n AND k.phrase = b.phrase`,
        ).run(this.minTotal);
        db.exec("DROP TABLE IF EXISTS agent_ngrams_build");

        // Bookkeeping commits with the swap so agent_ngrams and its
        // phrases.* watermark can never observe each other mid-update.
        const rowCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM agent_ngrams").get()!.n;
        setConfig(db, "phrases.lastBuiltAt", String(Date.now()));
        setConfig(db, "phrases.builtThroughMsgId", String(maxId));
        setConfig(db, "phrases.rowCount", String(rowCount));
      });
      swap();
    } finally {
      this.building = false;
    }
  }
}
