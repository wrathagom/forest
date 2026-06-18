export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;       // cap at 8× fit
export const ZOOM_STEP = 1.25;   // 25% per step

/** Step zoom in (dir=1) or out (dir=-1), clamped to [ZOOM_MIN, ZOOM_MAX]. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const next = dir === 1 ? z * ZOOM_STEP : z / ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/**
 * Clamp a pan offset so the scaled image cannot be dragged past its own edges.
 * `base` is the rendered (fit) image size; scaled size is base * z.
 */
export function clampPan(
  pan: { x: number; y: number },
  base: { w: number; h: number },
  container: { w: number; h: number },
  z: number,
): { x: number; y: number } {
  const maxX = Math.max(0, (base.w * z - container.w) / 2);
  const maxY = Math.max(0, (base.h * z - container.h) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}
