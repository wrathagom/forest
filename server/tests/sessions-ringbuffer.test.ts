import { describe, expect, test } from "bun:test";
import { ScrollbackRingBuffer } from "../src/sessions/ringbuffer";

describe("ScrollbackRingBuffer", () => {
  test("starts empty", () => {
    const b = new ScrollbackRingBuffer(100);
    expect(b.toString()).toBe("");
    expect(b.size()).toBe(0);
  });

  test("appends and concatenates in order", () => {
    const b = new ScrollbackRingBuffer(100);
    b.append("hello ");
    b.append("world");
    expect(b.toString()).toBe("hello world");
  });

  test("evicts oldest chunks once over the byte cap", () => {
    const b = new ScrollbackRingBuffer(10);
    b.append("aaaa"); // 4
    b.append("bbbb"); // 8 total
    b.append("cccc"); // would be 12 -> drop "aaaa"
    expect(b.toString()).toBe("bbbbcccc");
    expect(b.size()).toBe(8);
  });

  test("never evicts the only remaining chunk even if it alone exceeds the cap", () => {
    const b = new ScrollbackRingBuffer(5);
    b.append("a-very-long-single-chunk");
    expect(b.toString()).toBe("a-very-long-single-chunk");
  });

  test("clear empties the buffer", () => {
    const b = new ScrollbackRingBuffer(100);
    b.append("xyz");
    b.clear();
    expect(b.toString()).toBe("");
    expect(b.size()).toBe(0);
  });
});
