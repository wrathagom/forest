export type Moment = { uuid: string; label: string };

export type SummaryParse =
  | { ok: true; summary: string; moments: Moment[] }
  | { ok: false; reason: string };

export type EnvelopeParse = { ok: true; text: string } | { ok: false; reason: string };

const LABEL_MAX = 80;

// These strings are persisted to the database and rendered verbatim in the UI
// as the error state's message — write them for a human reading the summary
// panel, not for a log line.
const NOT_JSON = "Claude's reply wasn't valid JSON";
const NO_JSON_OBJECT = "Claude's reply contained no JSON object";

/** Haiku fence-wraps its JSON despite being told not to — measured, not assumed. */
export function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return m ? m[1]!.trim() : t;
}

/**
 * Recover the model's JSON object even when it didn't follow the "return
 * ONLY JSON" instruction to the letter. Two layers:
 *
 *  1. The common case — fenced JSON, handled by `stripFences`.
 *  2. A parse failure is a terminal, non-retried error downstream (each
 *     summarization attempt costs real money and time), so before giving up
 *     we fall back to slicing from the first `{` to the last `}` and trying
 *     again. This recovers prose prefaces/suffixes, unclosed or `~~~`
 *     fences, and fence language tags this regex doesn't recognize — all
 *     without weakening the anchored fence match above, which must stay
 *     anchored so an embedded ``` inside a JSON string value doesn't get
 *     mistaken for the closing fence.
 *
 * Throws an Error whose `message` is already the user-facing string the
 * caller should surface — the no-braces-at-all case is distinguishable from
 * "found braces but the contents still weren't valid JSON".
 */
function extractJsonPayload(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    // fall through to brace extraction
  }
  const first = raw.indexOf("{");
  if (first === -1) throw new Error(NO_JSON_OBJECT);
  const last = raw.lastIndexOf("}");
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new Error(NOT_JSON);
  }
}

/** Unwrap `claude --output-format json`'s envelope to the model's own text. */
export function resultTextFromEnvelope(stdout: string): EnvelopeParse {
  let env: unknown;
  try {
    env = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "Claude returned malformed output" };
  }
  if (!env || typeof env !== "object") return { ok: false, reason: "Claude returned malformed output" };
  const e = env as Record<string, unknown>;
  const text = typeof e.result === "string" ? e.result : "";
  if (e.is_error === true) {
    return { ok: false, reason: text.trim() || "claude reported an error" };
  }
  if (!text.trim()) return { ok: false, reason: "Claude returned no output" };
  return { ok: true, text };
}

/**
 * Parse the model's JSON and drop any anchor it did not copy from the digest.
 * This is the guard against hallucinated uuids: a moment survives only if its
 * uuid is in `validUuids`.
 */
export function parseSummaryOutput(raw: string, validUuids: Set<string>): SummaryParse {
  let obj: unknown;
  try {
    obj = extractJsonPayload(raw);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "Claude's reply wasn't a JSON object" };
  const o = obj as Record<string, unknown>;

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return { ok: false, reason: "Claude's reply had no summary field" };

  const moments: Moment[] = [];
  if (Array.isArray(o.moments)) {
    for (const entry of o.moments) {
      if (!entry || typeof entry !== "object") continue;
      const m = entry as Record<string, unknown>;
      const uuid = typeof m.uuid === "string" ? m.uuid.trim() : "";
      const label = typeof m.label === "string" ? m.label.trim() : "";
      if (!uuid || !label) continue;
      if (!validUuids.has(uuid)) continue;
      if (moments.some((x) => x.uuid === uuid)) continue;
      moments.push({ uuid, label: label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) + "…" : label });
    }
  }
  return { ok: true, summary, moments };
}
