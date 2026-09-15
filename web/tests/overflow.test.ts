import { describe, expect, test } from "vitest";
import { visibleCount } from "../src/lib/overflow";

describe("visibleCount", () => {
  test("no items → 0", () => {
    expect(visibleCount([], 500, 30)).toBe(0);
  });

  test("everything fits → all visible, nothing reserved for the menu", () => {
    // Last right edge lands exactly on the width: still fits.
    expect(visibleCount([100, 200, 300], 300, 30)).toBe(3);
  });

  test("partial fit reserves room for the menu", () => {
    // 4 items, width 250: not all fit. Usable = 250 - 30 = 220 → 2 items.
    expect(visibleCount([100, 200, 300, 400], 250, 30)).toBe(2);
  });

  test("an item that fits without the reserve but not with it is hidden", () => {
    // Width 300 fits 3 of 4 outright, but after reserving 30 only 2 fit.
    expect(visibleCount([100, 200, 300, 400], 300, 30)).toBe(2);
  });

  test("first item too wide → 0", () => {
    expect(visibleCount([400, 500], 250, 30)).toBe(0);
  });

  test("zero geometry (jsdom) → everything visible", () => {
    expect(visibleCount([0, 0, 0], 0, 0)).toBe(3);
  });
});
