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
  if (rights.length === 0) return 0;
  if (rights[rights.length - 1] <= width) return rights.length;
  const limit = width - reserve;
  let n = 0;
  while (n < rights.length && rights[n] <= limit) n++;
  return n;
}
