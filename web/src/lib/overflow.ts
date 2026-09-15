/**
 * How many leading items fit in `width`.
 *
 * `rights[i]` is the right edge of item i when every item is laid out on one
 * unconstrained line, so it already includes any separators and gaps before
 * it. If every item fits, all are visible and no menu is needed. Otherwise
 * `reserve` (the ☰ trigger's width plus one gap) is taken off the width and
 * the count of leading items whose right edge still fits is returned — which
 * can be 0 when even the first item is too wide.
 */
export function visibleCount(rights: number[], width: number, reserve: number): number {
  const total = rights.length;
  if (total === 0) return 0;
  // Bounds are guaranteed by the length checks, so the indexed reads are safe
  // under noUncheckedIndexedAccess.
  if (rights[total - 1]! <= width) return total;
  const limit = width - reserve;
  let n = 0;
  while (n < total && rights[n]! <= limit) n++;
  return n;
}
