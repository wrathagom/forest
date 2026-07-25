import { createEffect, createMemo } from "solid-js";
import { marked } from "marked";
import mermaid from "mermaid";
import { currentTheme } from "../lib/themes/current";

marked.setOptions({ gfm: true, breaks: true });

// mermaid takes a config object rather than reading CSS, so these have to be
// literal token values. Its "base" theme is the only one that honours
// themeVariables — the old fixed `theme: "dark"` is simply wrong on a light
// theme. Guarded on the theme id because mermaid's config is global while
// Markdown mounts once per message block: without it, a long transcript would
// re-initialize mermaid hundreds of times for no reason.
let initializedThemeId: string | null = null;

function initMermaid(): void {
  const theme = currentTheme();
  if (theme.id === initializedThemeId) return;
  initializedThemeId = theme.id;
  const { tokens } = theme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: tokens.bg,
      mainBkg: tokens.bg2,
      primaryColor: tokens.bg2,
      primaryTextColor: tokens.fg,
      primaryBorderColor: tokens.border,
      secondaryColor: tokens.bg3,
      tertiaryColor: tokens.bg3,
      lineColor: tokens.fgDim,
      textColor: tokens.fg,
      nodeBorder: tokens.borderStrong,
    },
  });
}

initMermaid();

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

  // Re-initialize mermaid and re-render every already-rendered diagram when the
  // theme changes. Rendered blocks carry .mermaid-rendered; resetting them to
  // .mermaid-pending puts them back through the existing render path. Clearing
  // textContent is safe because renderMermaid reads its source from data-src,
  // which survives the wipe.
  createEffect(() => {
    currentTheme();
    initMermaid();
    container?.querySelectorAll<HTMLElement>("pre.mermaid-rendered").forEach((el) => {
      el.className = "mermaid-pending";
      el.textContent = "";
      void renderMermaid(el);
    });
  });

  return <div ref={container} class="markdown-body" innerHTML={html()} />;
}
