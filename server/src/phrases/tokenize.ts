// Pure text → filtered n-gram extraction for the phrase index. No I/O.
// Input is the raw JSONL envelope stored in agent_messages.content.

export const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "while",
  "of", "at", "by", "for", "with", "about", "against", "between", "into",
  "through", "during", "before", "after", "above", "below", "to", "from", "up",
  "down", "in", "out", "on", "off", "over", "under", "again", "further", "is",
  "am", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "having", "do", "does", "did", "doing", "would", "should", "could", "can",
  "will", "shall", "may", "might", "must", "i", "you", "he", "she", "it", "we",
  "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
  "their", "this", "that", "these", "those", "there", "here", "what", "which",
  "who", "whom", "whose", "as", "so", "than", "too", "very", "just", "not",
  "no", "nor", "only", "own", "same", "such", "each", "few", "more", "most",
  "other", "some", "any", "all", "both", "let", "s", "t", "re", "ll", "ve", "d", "m",
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "it's", "that's",
  "let's", "we're", "we'll", "don't", "doesn't", "didn't", "isn't", "aren't",
]);

// Strip fenced code (``` or ~~~), inline code, and common markdown markup so we
// count prose, not code or syntax.
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → their label
    .replace(/[*_#>~|]/g, " ");
}

/** Extract only assistant `text` blocks from a stored JSONL line, as prose. */
export function assistantProseText(rawLine: string): string {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawLine);
  } catch {
    return "";
  }
  const message = (raw.message as Record<string, unknown>) ?? {};
  const role = typeof message.role === "string" ? message.role : (raw.type as string);
  if (role !== "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return stripMarkdown(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return stripMarkdown(parts.join("\n"));
}

/** Lowercased sentences (split on .!?;: and newlines), empties removed. */
export function sentences(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[.!?;:\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Word tokens; apostrophe-joined words (you're, let's) stay intact. */
export function tokenize(sentence: string): string[] {
  return sentence.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

export type Ngram = { n: number; phrase: string };

/** All n-grams for nMin..nMax within one token list (no cross-list spans). */
export function ngrams(tokens: string[], nMin = 2, nMax = 5): Ngram[] {
  const out: Ngram[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = nMin; n <= nMax; n++) {
      if (i + n > tokens.length) break;
      out.push({ n, phrase: tokens.slice(i, i + n).join(" ") });
    }
  }
  return out;
}

export function isAllStopwords(phrase: string): boolean {
  const toks = phrase.split(" ");
  return toks.length > 0 && toks.every((t) => STOPWORDS.has(t));
}

/** Raw JSONL line → filtered phrases. Sentences bound the n-gram windows. */
export function extractPhrases(rawLine: string, opts?: { nMin?: number; nMax?: number }): Ngram[] {
  const nMin = opts?.nMin ?? 2;
  const nMax = opts?.nMax ?? 5;
  const prose = assistantProseText(rawLine);
  if (!prose) return [];
  const out: Ngram[] = [];
  for (const sentence of sentences(prose)) {
    for (const g of ngrams(tokenize(sentence), nMin, nMax)) {
      if (!isAllStopwords(g.phrase)) out.push(g);
    }
  }
  return out;
}

/** UTC month bucket 'YYYY-MM' for an epoch-ms timestamp. */
export function monthOf(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 7);
}
