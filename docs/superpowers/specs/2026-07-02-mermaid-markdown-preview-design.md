# Mermaid rendering in the markdown preview

**Date:** 2026-07-02
**Status:** Approved design — pending implementation

## Summary

Add [Mermaid](https://mermaid.js.org/) diagram rendering to Forest's markdown
preview. A fenced code block tagged `mermaid` renders as an SVG diagram instead
of a plain code block, everywhere the shared `Markdown` component is used:

- the file-editor markdown **preview** mode (`FileEditor.tsx`), and
- **agent transcript** messages (`MessageBlocks.tsx`).

Both surfaces use the single `web/src/components/Markdown.tsx` component, so one
change covers both.

## Requirements

- ` ```mermaid ` fences render as diagrams; all other code fences render exactly
  as they do today (stock `marked`, no change).
- Diagrams use a **dark** theme to match Forest's single dark palette
  (`:root { --bg:#0e0e10 }`, no light-mode toggle exists).
- **Invalid syntax falls back to a normal code block.** During agent streaming a
  half-written diagram simply shows as a ` ```mermaid ` code block until it parses
  cleanly, then renders. No error boxes.
- Mermaid is imported **statically** (bundled normally). Accepted trade-off:
  ~2–3MB added to the main JS bundle (mermaid pulls in d3).

## Non-goals

- No syntax highlighting for other languages.
- No light-theme support (Forest has none).
- No sanitization changes — content is the user's own agent output on their own
  machine, consistent with the existing `Markdown` comment.
- No pan/zoom/export controls on diagrams. Static SVG only.

## Architecture

The entire change is contained in:

- `web/src/components/Markdown.tsx` — interception + async render.
- `web/package.json` — add the `mermaid` dependency.
- `web/src/styles.css` — minimal styling for the rendered diagram container.
- `web/tests/Markdown.test.tsx` — new test cases (mermaid mocked).

### 1. Fence interception (parse-time, synchronous)

Register a `marked` custom `code` renderer. In marked v18 the renderer receives
a token object. When the language's first word is `mermaid`, emit a placeholder
instead of a code block; otherwise return `false` so marked uses its default
renderer (preserving today's behavior exactly).

```ts
marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang || "").trim().split(/\s+/)[0];
      if (lang === "mermaid") {
        // data-src carries the raw source (uri-encoded so it is attribute-safe);
        // the visible text is the escaped source, which also serves as the
        // pre-render / fallback appearance.
        return `<pre class="mermaid-pending" data-src="${encodeURIComponent(token.text)}">` +
          `${escapeHtml(token.text)}</pre>`;
      }
      return false; // fall through to marked's default code renderer
    },
  },
});
```

`escapeHtml` escapes `& < > " '` for the visible fallback text.

### 2. Diagram render (post-render, asynchronous)

`Markdown` gains a container ref and a `createEffect` that tracks the parsed
`html()`. After each render pass it finds every `pre.mermaid-pending` and
processes it:

```tsx
let container: HTMLDivElement | undefined;
const html = createMemo(() => marked.parse(props.text, { async: false }) as string);

createEffect(() => {
  html();                       // re-run whenever the parsed markdown changes
  const el = container;
  if (!el) return;
  for (const block of el.querySelectorAll<HTMLElement>("pre.mermaid-pending")) {
    void renderMermaid(block);
  }
});

async function renderMermaid(block: HTMLElement) {
  const src = decodeURIComponent(block.dataset.src || "");
  // Validate without DOM side-effects; mermaid.render can leave orphan error
  // nodes, mermaid.parse does not.
  const ok = await mermaid.parse(src, { suppressErrors: true });
  if (!ok) {
    // graceful fallback: turn the placeholder into a plain code block
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = src;
    pre.appendChild(code);
    block.replaceWith(pre);
    return;
  }
  const { svg } = await mermaid.render(`mmd-${nextId()}`, src);
  block.innerHTML = svg;
  block.classList.replace("mermaid-pending", "mermaid-rendered");
}
```

`nextId()` is a module-level incrementing counter (avoids `Date.now`/`Math.random`
and guarantees unique element ids across renders).

### 3. Initialization (once, at module load)

```ts
mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
```

`startOnLoad: false` because we drive rendering ourselves. `securityLevel:
"strict"` HTML-escapes diagram labels — safe and sufficient for diagrams.

## Data flow

```
props.text
  → marked.parse (sync, custom code renderer)
      → mermaid fence  → <pre class="mermaid-pending" data-src=…>
      → other fence    → <pre><code> (unchanged)
  → innerHTML into .markdown-body
  → createEffect finds .mermaid-pending
      → mermaid.parse ok?  → mermaid.render → inject <svg>
      → not ok             → replace with <pre><code> (fallback)
```

## Streaming behavior

Each change to `props.text` re-parses and re-emits placeholders, so any
previously rendered SVG is replaced by a fresh `.mermaid-pending` and
re-rendered. This is simple and correct; diagrams are small and local, so
re-rendering per token is acceptable. Stale async callbacks that resolve after
the container's `innerHTML` was replaced write to detached nodes — harmless.

If per-token re-rendering ever proves too heavy, a future optimization is to
skip re-render when a block's `data-src` is unchanged from the last pass; out of
scope for this change.

## Error handling

- **Invalid mermaid syntax:** detected by `mermaid.parse(..., { suppressErrors:
  true })` returning `false`; the placeholder is replaced by a plain
  `<pre><code>` block. No thrown errors reach the UI.
- **Unexpected `mermaid.render` throw:** wrapped so it also falls back to the
  code block (belt-and-suspenders around the parse check).

## Styling

Add to `web/src/styles.css`:

- `.markdown-body pre.mermaid-rendered` — transparent background, no border,
  centered, `overflow-x:auto` so wide diagrams scroll rather than overflow.
- `.markdown-body pre.mermaid-pending` — inherits the existing `<pre>` styling so
  a not-yet-rendered / streaming diagram reads as a normal code block.

## Testing

`web/tests/Markdown.test.tsx` runs under vitest + `@solidjs/testing-library` in
jsdom, which cannot lay out real SVG, so `mermaid` is mocked with `vi.mock`:

- **placeholder:** a ` ```mermaid ` fence produces a `pre.mermaid-pending` whose
  `data-src` decodes to the diagram source.
- **valid render:** with `mermaid.parse` mocked to resolve `true` and
  `mermaid.render` mocked to return `{ svg: "<svg data-testid=…>" }`, the block
  ends up containing the injected SVG and carries `.mermaid-rendered`.
- **invalid fallback:** with `mermaid.parse` mocked to resolve `false`, the block
  becomes a `<pre><code>` containing the raw source.
- **regression:** the existing "fenced code block → `<pre><code>`" test still
  passes (non-mermaid fences untouched).

All existing `Markdown.test.tsx` cases remain green.

## Trade-offs

- **Static import (+~2–3MB bundle)** chosen for code simplicity over a lazy
  `import()`. The render path is isolated enough that switching to lazy loading
  later is a one-line change (`await import("mermaid")` inside `renderMermaid`).
- **Re-render per streaming token** chosen for simplicity over diff-based
  caching. Acceptable given small, local diagrams.
