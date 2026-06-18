import { createSignal, For, Show } from "solid-js";
import type { ProjectRow } from "../api";

type Source = { type: "blank" } | { type: "clone"; url: string };

export type CreateProjectFn = (body: {
  name: string;
  subdir: string;
  source: Source;
}) => Promise<{ project: ProjectRow }>;

export default function NewProjectModal(props: {
  subdirs: string[];
  api: CreateProjectFn;
  onCreated: (project: ProjectRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = createSignal("");
  const [subdir, setSubdir] = createSignal("");
  const [mode, setMode] = createSignal<"blank" | "clone">("blank");
  const [cloneUrl, setCloneUrl] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9._-]+$/.test(name())) {
      setError("name: letters, digits, . _ - only");
      return;
    }
    if (mode() === "clone" && !cloneUrl().trim()) {
      setError("clone URL is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const source: Source = mode() === "blank"
        ? { type: "blank" }
        : { type: "clone", url: cloneUrl().trim() };
      const { project } = await props.api({ name: name(), subdir: subdir(), source });
      props.onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="modal-backdrop">
      <div class="modal">
        <header class="modal-head">
          <span>new project</span>
          <button
            class="modal-close"
            onclick={() => !submitting() && props.onClose()}
            disabled={submitting()}
            title="close"
          >×</button>
        </header>
        <form class="modal-body" onsubmit={submit}>
          <label class="modal-field">
            name
            <input
              type="text"
              placeholder="project name"
              value={name()}
              oninput={(e) => setName(e.currentTarget.value)}
              disabled={submitting()}
            />
            <Show when={!error()}>
              <span class="hint">letters, digits, . _ -</span>
            </Show>
          </label>

          <label class="modal-field">
            sub-dir
            <select
              value={subdir()}
              onchange={(e) => setSubdir(e.currentTarget.value)}
              disabled={submitting()}
            >
              <option value="">— direct under root —</option>
              <For each={props.subdirs}>
                {(s) => <option value={s}>{s}</option>}
              </For>
            </select>
          </label>

          <fieldset class="modal-field modal-mode">
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode() === "blank"}
                oninput={() => setMode("blank")}
                disabled={submitting()}
              />
              blank (git init + README)
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                aria-label="clone from URL"
                checked={mode() === "clone"}
                oninput={() => setMode("clone")}
                disabled={submitting()}
              />
              clone from URL
            </label>
          </fieldset>

          <Show when={mode() === "clone"}>
            <label class="modal-field">
              clone URL
              <input
                type="text"
                placeholder="clone url (https or ssh)"
                value={cloneUrl()}
                oninput={(e) => setCloneUrl(e.currentTarget.value)}
                disabled={submitting()}
              />
            </label>
          </Show>

          <Show when={error()}>
            <div class="banner banner-error">{error()}</div>
          </Show>

          <div class="modal-actions">
            <button type="submit" disabled={submitting()}>
              {submitting() ? (mode() === "blank" ? "creating…" : "cloning…") : "create"}
            </button>
            <button
              type="button"
              onclick={() => !submitting() && props.onClose()}
              disabled={submitting()}
            >
              cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
