import { describe, expect, test } from "bun:test";
import { imageMimeFor } from "../src/routes/files";

describe("imageMimeFor", () => {
  test("maps common raster extensions to MIME types", () => {
    expect(imageMimeFor("a/b/pic.png")).toBe("image/png");
    expect(imageMimeFor("photo.jpg")).toBe("image/jpeg");
    expect(imageMimeFor("photo.jpeg")).toBe("image/jpeg");
    expect(imageMimeFor("anim.gif")).toBe("image/gif");
    expect(imageMimeFor("x.webp")).toBe("image/webp");
    expect(imageMimeFor("x.bmp")).toBe("image/bmp");
    expect(imageMimeFor("favicon.ico")).toBe("image/x-icon");
    expect(imageMimeFor("x.avif")).toBe("image/avif");
  });

  test("maps svg to image/svg+xml", () => {
    expect(imageMimeFor("logo.svg")).toBe("image/svg+xml");
  });

  test("is case-insensitive", () => {
    expect(imageMimeFor("PIC.PNG")).toBe("image/png");
    expect(imageMimeFor("Logo.SVG")).toBe("image/svg+xml");
  });

  test("returns null for non-image extensions", () => {
    expect(imageMimeFor("main.ts")).toBeNull();
    expect(imageMimeFor("README.md")).toBeNull();
    expect(imageMimeFor("blob.bin")).toBeNull();
    expect(imageMimeFor("noext")).toBeNull();
  });
});
