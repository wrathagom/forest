/**
 * Stub jsdom's zero geometry so OverflowRow can measure. Call `restore()` in
 * afterEach. See OverflowRow.tsx `measure()` for what is read and why.
 */
export type GeometryStub = {
  setRowWidth(w: number): void;
  restore(): void;
};

export function stubGeometry(opts: { rowWidth: number; itemWidth?: number; moreWidth?: number }): GeometryStub {
  let rowWidth = opts.rowWidth;
  const itemWidth = opts.itemWidth ?? 0;
  const moreWidth = opts.moreWidth ?? 30;

  const widthOf = (el: Element | null): number => {
    if (!el) return 0;
    const src = el.querySelector<HTMLElement>("[data-w]");
    return src ? Number(src.dataset.w) : itemWidth;
  };

  const names = ["offsetWidth", "offsetLeft", "clientWidth"] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const n of names) saved.set(n, Object.getOwnPropertyDescriptor(HTMLElement.prototype, n));

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("overflow-item")) return widthOf(this);
      if (this.classList.contains("overflow-more")) return moreWidth;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("overflow-item")) return 0;
      let x = 0;
      for (let s = this.previousElementSibling; s; s = s.previousElementSibling) x += widthOf(s);
      return x;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("overflow-row") ? rowWidth : 0;
    },
  });

  return {
    setRowWidth(w) { rowWidth = w; },
    restore() {
      for (const n of names) {
        const d = saved.get(n);
        if (d) Object.defineProperty(HTMLElement.prototype, n, d);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[n];
      }
    },
  };
}
