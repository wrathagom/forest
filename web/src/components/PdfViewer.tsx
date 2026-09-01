import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

export default function PdfViewer(props: { src: string }) {
  let canvas!: HTMLCanvasElement;
  let textLayerDiv!: HTMLDivElement;

  const [doc, setDoc] = createSignal<PdfDoc | null>(null);
  const [pageNum, setPageNum] = createSignal(1);
  const [pageCount, setPageCount] = createSignal(0);
  const [scale, setScale] = createSignal(1);
  const [error, setError] = createSignal<string | null>(null);

  // Load (or reload) the document whenever src changes.
  createEffect(() => {
    const src = props.src;
    setError(null);
    setDoc(null);
    setPageCount(0);
    setPageNum(1);

    const task = pdfjs.getDocument(src);
    let cancelled = false;
    task.promise
      .then((d) => {
        if (cancelled) {
          void d.destroy();
          return;
        }
        setDoc(d);
        setPageCount(d.numPages);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    onCleanup(() => {
      cancelled = true;
      void task.destroy();
      void doc()?.destroy();
    });
  });

  // Render the current page whenever doc, page, or scale changes.
  createEffect(() => {
    const d = doc();
    const n = pageNum();
    const s = scale();
    if (!d) return;
    let cancelled = false;

    d.getPage(n)
      .then(async (page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: s });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // pdf.js's text layer positions glyphs using the --scale-factor var.
        textLayerDiv.style.setProperty("--scale-factor", String(s));
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.replaceChildren();

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  const prev = () => setPageNum((p) => Math.max(1, p - 1));
  const next = () => setPageNum((p) => Math.min(pageCount(), p + 1));
  const zoomIn = () => setScale((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setScale((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const fit = () => setScale(1);

  return (
    <div class="file-editor-pdf">
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <div class="pdf-scroll">
        <div class="pdf-page">
          <canvas ref={canvas!} />
          <div ref={textLayerDiv!} class="textLayer" />
        </div>
      </div>
      <div class="pdf-controls">
        <button
          class="editor-status-toggle"
          aria-label="previous page"
          disabled={pageNum() <= 1}
          onclick={prev}
        >
          ‹
        </button>
        <span class="pdf-page-readout">
          {pageNum()} / {pageCount() || "…"}
        </span>
        <button
          class="editor-status-toggle"
          aria-label="next page"
          disabled={pageNum() >= pageCount()}
          onclick={next}
        >
          ›
        </button>
        <span class="pdf-control-sep" />
        <button
          class="editor-status-toggle"
          aria-label="zoom out"
          disabled={scale() <= ZOOM_MIN}
          onclick={zoomOut}
        >
          −
        </button>
        <span class="image-zoom-readout">{Math.round(scale() * 100)}%</span>
        <button
          class="editor-status-toggle"
          aria-label="zoom in"
          disabled={scale() >= ZOOM_MAX}
          onclick={zoomIn}
        >
          +
        </button>
        <button class="editor-status-toggle" disabled={scale() === 1} onclick={fit}>
          fit
        </button>
      </div>
    </div>
  );
}
