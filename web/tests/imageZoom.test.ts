import { describe, expect, test } from "vitest";
import { stepZoom, clampPan, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../src/lib/imageZoom";

describe("stepZoom", () => {
  test("zooms in by ZOOM_STEP", () => {
    expect(stepZoom(1, 1)).toBeCloseTo(ZOOM_STEP);
  });

  test("zooms out by ZOOM_STEP", () => {
    expect(stepZoom(2, -1)).toBeCloseTo(2 / ZOOM_STEP);
  });

  test("clamps to ZOOM_MIN when zooming out from fit", () => {
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  test("clamps to ZOOM_MAX when zooming in past max", () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
  });
});

describe("clampPan", () => {
  test("returns 0,0 when scaled image is not larger than container", () => {
    const r = clampPan({ x: 50, y: 50 }, { w: 100, h: 100 }, { w: 200, h: 200 }, 1);
    expect(r).toEqual({ x: 0, y: 0 });
  });

  test("clamps pan to half the overflow on each axis", () => {
    // base 200x200 at 2x = 400x400, container 200x200 -> overflow 200 -> max 100
    const r = clampPan({ x: 500, y: -500 }, { w: 200, h: 200 }, { w: 200, h: 200 }, 2);
    expect(r).toEqual({ x: 100, y: -100 });
  });

  test("leaves in-range pan untouched", () => {
    const r = clampPan({ x: 30, y: -40 }, { w: 200, h: 200 }, { w: 200, h: 200 }, 2);
    expect(r).toEqual({ x: 30, y: -40 });
  });

  test("clamps x and y independently for non-square image (w !== h)", () => {
    // base 400x200 at 1x, container 100x100
    // scaled: 400x200; overflow x = 300 -> maxX = 150; overflow y = 100 -> maxY = 50
    const r = clampPan({ x: 999, y: 999 }, { w: 400, h: 200 }, { w: 100, h: 100 }, 1);
    expect(r).toEqual({ x: 150, y: 50 });
  });
});
