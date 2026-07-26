import { describe, expect, test } from "vitest";
import { TOKEN_KEYS } from "../src/lib/themes/types";

describe("TOKEN_KEYS", () => {
  test("lists all 38 tokens", () => {
    expect(TOKEN_KEYS).toHaveLength(38);
  });

  test("has no duplicates", () => {
    expect(new Set(TOKEN_KEYS).size).toBe(TOKEN_KEYS.length);
  });

  test("includes the role tokens the CSS depends on", () => {
    for (const key of ["bg", "bg2", "bg3", "accent", "accentFg", "ok", "warn", "error", "info"]) {
      expect(TOKEN_KEYS).toContain(key);
    }
  });
});
