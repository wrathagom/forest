export class ScrollbackRingBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}

  append(s: string): void {
    if (s.length === 0) return;
    this.chunks.push(s);
    this.bytes += s.length;
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.bytes -= removed.length;
    }
  }

  toString(): string {
    return this.chunks.join("");
  }

  size(): number {
    return this.bytes;
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
  }
}
