import type { Database } from "bun:sqlite";

export type PhraseMonth = { month: string; count: number };
export type PhraseRow = {
  phrase: string;
  n: number;
  count: number;
  monthly: PhraseMonth[];
  trendScore: number;
};
export type PhraseLeaderboard = { phrases: PhraseRow[]; total: number };
export type PhraseOccurrence = {
  session_id: string;
  project_id: string | null;
  timestamp: number;
  snippet: string;
};

/** recentCount − average of prior months. A phrase seen only in the newest
 *  month scores its full recent count (baseline 0), so emergent phrases rank up. */
export function computeTrend(monthly: PhraseMonth[], recentMonth: string): number {
  let recentCount = 0;
  let priorTotal = 0;
  let priorMonths = 0;
  for (const m of monthly) {
    if (m.month === recentMonth) recentCount += m.count;
    else if (m.month < recentMonth) {
      priorTotal += m.count;
      priorMonths++;
    }
  }
  const baseline = priorMonths ? priorTotal / priorMonths : 0;
  return recentCount - baseline;
}

export class PhraseStore {
  constructor(private readonly db: Database) {}

  leaderboard(opts: {
    agent: string;
    n: number;
    from?: string;
    to?: string;
    sort: "count" | "trending";
    limit: number;
    offset: number;
  }): PhraseLeaderboard {
    const limit = Math.min(Math.max(opts.limit, 1), 200);
    const offset = Math.max(opts.offset, 0);
    const where = ["agent = ?", "n = ?"];
    const params: unknown[] = [opts.agent, opts.n];
    if (opts.from) {
      where.push("month >= ?");
      params.push(opts.from);
    }
    if (opts.to) {
      where.push("month <= ?");
      params.push(opts.to);
    }
    const rows = this.db
      .query<{ phrase: string; month: string; count: number }, unknown[]>(
        `SELECT phrase, month, count FROM agent_ngrams WHERE ${where.join(" AND ")}`,
      )
      .all(...params);

    let recentMonth = "";
    const byPhrase = new Map<string, PhraseMonth[]>();
    for (const r of rows) {
      if (r.month > recentMonth) recentMonth = r.month;
      const list = byPhrase.get(r.phrase) ?? [];
      list.push({ month: r.month, count: r.count });
      byPhrase.set(r.phrase, list);
    }

    const list: PhraseRow[] = [];
    for (const [phrase, monthly] of byPhrase) {
      monthly.sort((a, b) => a.month.localeCompare(b.month));
      const count = monthly.reduce((s, m) => s + m.count, 0);
      list.push({ phrase, n: opts.n, count, monthly, trendScore: computeTrend(monthly, recentMonth) });
    }

    const keyOf = opts.sort === "trending" ? (r: PhraseRow) => r.trendScore : (r: PhraseRow) => r.count;
    list.sort((a, b) => keyOf(b) - keyOf(a) || b.count - a.count || (a.phrase < b.phrase ? -1 : 1));

    return { phrases: list.slice(offset, offset + limit), total: list.length };
  }

  occurrences(opts: { phrase: string; agent: string; limit: number; offset: number }): PhraseOccurrence[] {
    const limit = Math.min(Math.max(opts.limit, 1), 200);
    const offset = Math.max(opts.offset, 0);
    const match = `"${opts.phrase.replace(/"/g, '""')}"`;
    const needle = opts.phrase.toLowerCase();
    // The FTS index is porter-stemmed, so MATCH over-matches inflections
    // ("matters" also hits "mattered"). Use it as a fast prefilter, then keep
    // only candidates whose stored text literally contains the phrase. Cap the
    // candidate scan since the phrase is rare.
    const CANDIDATE_CAP = 500;
    try {
      const rows = this.db
        .query<PhraseOccurrence & { text: string }, [string, string, number]>(
          `SELECT s.session_id AS session_id, s.project_id AS project_id, m.timestamp AS timestamp,
                  agent_messages_fts.text AS text,
                  snippet(agent_messages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
             FROM agent_messages_fts
             JOIN agent_messages m ON m.id = agent_messages_fts.message_id
             JOIN agent_sessions s ON s.session_id = m.session_id
            WHERE agent_messages_fts MATCH ? AND m.role = 'assistant' AND s.agent = ?
            ORDER BY m.timestamp DESC
            LIMIT ?`,
        )
        .all(match, opts.agent, CANDIDATE_CAP);
      return rows
        .filter((r) => r.text.toLowerCase().includes(needle))
        .slice(offset, offset + limit)
        .map(({ text, ...o }) => o);
    } catch (err) {
      // A balanced quoted phrase can still trip FTS5 on pathological input; only
      // swallow that. Anything else is a real bug and should surface.
      if (String(err).includes("fts5")) return [];
      throw err;
    }
  }
}
