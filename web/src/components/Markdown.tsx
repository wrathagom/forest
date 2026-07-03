import { createEffect, createMemo } from "solid-js";
import { marked } from "marked";
import mermaid from "mermaid";

marked.setOptions({ gfm: true, breaks: true });

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

// Escapes the five HTML-significant characters for the visible fallback text.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Module-level counter for unique diagram element ids (no Date.now/Math.random).
let idCounter = 0;
const nextId = () => ++idCounter;

// Intercept ```mermaid fences at parse time: emit a placeholder carrying the
// raw source. All other fences fall through to marked's default renderer.
marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang || "").trim().split(/\s+/)[0];
      if (lang === "mermaid") {
        return (
          `<pre class="mermaid-pending" data-src="${encodeURIComponent(token.text)}">` +
          `${escapeHtml(token.text)}</pre>`
        );
      }
      return false; // fall through to marked's default code renderer
    },
  },
});

async function renderMermaid(block: HTMLElement) {
  const src = decodeURIComponent(block.dataset.src || "");
  const fallback = () => {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = src;
    pre.appendChild(code);
    block.replaceWith(pre);
  };
  try {
    // mermaid.parse validates without DOM side-effects (mermaid.render can
    // leave orphan error nodes); it returns false on invalid syntax.
    const ok = await mermaid.parse(src, { suppressErrors: true });
    if (!ok) {
      fallback();
      return;
    }
    const { svg } = await mermaid.render(`mmd-${nextId()}`, src);
    block.innerHTML = svg;
    block.classList.replace("mermaid-pending", "mermaid-rendered");
  } catch {
    fallback();
  }
}

// Renders a chunk of markdown (agent prose) as HTML. The source is our own
// agent-session output running in the user's browser against their own
// machine, so we don't sanitize — fidelity over a threat that isn't there.
export default function Markdown(props: { text: string }) {
  let container: HTMLDivElement | undefined;
  const html = createMemo(() => marked.parse(props.text, { async: false }) as string);

  createEffect(() => {
    html(); // re-run whenever the parsed markdown changes
    const el = container;
    if (!el) return;
    for (const block of el.querySelectorAll<HTMLElement>("pre.mermaid-pending")) {
      void renderMermaid(block);
    }
  });

  return <div ref={container} class="markdown-body" innerHTML={html()} />;
}
