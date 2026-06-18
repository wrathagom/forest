import { createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useProjects } from "../../projects-context";
import { launchAgentRun, type MobilePermissionMode } from "../../api";

const MODES: { id: MobilePermissionMode; label: string }[] = [
  { id: "plan", label: "Plan only" },
  { id: "acceptEdits", label: "Accept edits" },
  { id: "bypassPermissions", label: "Full auto" },
];

export default function NewRun() {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const list = () => (projects()?.projects ?? []).filter((p) => !p.hidden);
  const [picked, setPicked] = createSignal("");
  const projectId = () => picked() || list()[0]?.id || "";
  const [prompt, setPrompt] = createSignal("");
  const [mode, setMode] = createSignal<MobilePermissionMode>("acceptEdits");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const projectName = () => list().find((p) => p.id === projectId())?.name ?? "";

  const submit = async (e: Event) => {
    e.preventDefault();
    const pid = projectId();
    if (!pid || !prompt().trim() || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await launchAgentRun({ projectId: pid, prompt: prompt().trim(), permissionMode: mode() });
      navigate(`/m/s/${encodeURIComponent(sessionId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onsubmit={submit}>
      <Show when={error()}><div class="m-error">{error()}</div></Show>
      <label class="m-field-label" for="m-new-project">Project</label>
      <Show
        when={list().length > 0}
        fallback={<select class="m-select" disabled><option>loading projects…</option></select>}
      >
        {/* `selected` on each option (not just `value` on the select) so the
            choice survives the projects poll re-creating the <option> nodes. */}
        <select id="m-new-project" class="m-select" value={projectId()} onchange={(e) => setPicked(e.currentTarget.value)}>
          <For each={list()}>{(p) => <option value={p.id} selected={p.id === projectId()}>{p.name}</option>}</For>
        </select>
      </Show>
      <label class="m-field-label" for="m-new-prompt">Prompt</label>
      <textarea id="m-new-prompt" class="m-textarea" value={prompt()} oninput={(e) => setPrompt(e.currentTarget.value)} placeholder="what should the agent do?" />
      <div class="m-field-label">Permissions</div>
      <div class="m-seg">
        <For each={MODES}>{(m) => (
          <button type="button" aria-pressed={mode() === m.id ? "true" : "false"} onclick={() => setMode(m.id)}>{m.label}</button>
        )}</For>
      </div>
      <button type="submit" class="m-btn" disabled={busy() || !prompt().trim() || !projectId()}>
        {busy() ? "Launching…" : "Launch run"}
      </button>
      <Show when={projectId()}>
        <div class="m-hint">Runs headless in {projectName()}'s main checkout.</div>
      </Show>
    </form>
  );
}
