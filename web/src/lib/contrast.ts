// WCAG 2.1 relative luminance and contrast ratio, plus hex mixing.
// Lives in src/ (not tests/) because colorBy.ts derives band foregrounds
// from real contrast ratios at runtime.

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Mix two hex colors in sRGB. `pctA` is how much of `a` to keep (0-100).
 * Numeric rather than CSS `color-mix()` because the result has to be fed back
 * into a contrast calculation, which CSS cannot do.
 */
export function mixHex(a: string, b: string, pctA: number): string {
  const t = Math.max(0, Math.min(100, pctA)) / 100;
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t));
}
