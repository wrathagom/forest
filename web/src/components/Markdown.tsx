import { createMemo } from "solid-js";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

// Renders a chunk of markdown (agent prose) as HTML. The source is our own
// agent-session output running in the user's browser against their own
// machine, so we don't sanitize — fidelity over a threat that isn't there.
export default function Markdown(props: { text: string }) {
  const html = createMemo(() => marked.parse(props.text, { async: false }) as string);
  return <div class="markdown-body" innerHTML={html()} />;
}
