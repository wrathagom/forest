import {
  createSignal,
  createResource,
  onCleanup,
  onMount,
  Show,
  Switch,
  Match,
  getOwner,
  runWithOwner,
} from "solid-js";
import { EditorState, type Extension, Compartment } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { searchKeymap } from "@codemirror/search";
import { fetchFile, writeFile, fileRawUrl, fetchGitDiff } from "../api";
import { loadLanguageExtension } from "../lib/language";
import Markdown from "./Markdown";
import EditorStatusBar, { type EditorStats } from "./EditorStatusBar";
import ImageViewer from "./ImageViewer";
import PdfViewer from "./PdfViewer";
import { markdownStats, cursorStats } from "../lib/editorStats";

type Loaded =
  | { kind: "text"; mtimeMs: number; sha: string; language: string }
  | { kind: "image"; size: number; mime: string; mtimeMs: number }
  | { kind: "pdf"; size: number; mtimeMs: number }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number };

const POLL_MS = 2000;

// CodeMirror compiles both the highlight style and the editor theme to real
// CSS via StyleModule, so `var()` resolves normally and the editor recolors
// itself on a theme change with no subscription and no re-mount.
const forestHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: t.controlKeyword, color: "var(--syn-keyword)" },
  { tag: t.moduleKeyword, color: "var(--syn-keyword)" },
  { tag: t.definitionKeyword, color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.tagName], color: "var(--syn-tag)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: t.operator, color: "var(--syn-operator)" },
  { tag: [t.regexp, t.escape, t.special(t.escape)], color: "var(--syn-operator)" },
  { tag: t.heading, color: "var(--syn-keyword)", fontWeight: "bold" },
  { tag: t.link, color: "var(--syn-function)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
]);

const forestTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "var(--bg)", color: "var(--fg)", height: "100%", fontSize: "13px" },
    ".cm-content": {
      fontFamily:
        '"FiraCode Nerd Font Mono", "FiraCode Nerd Font", ui-monospace, Menlo, monospace',
      caretColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg)",
      color: "var(--fg-faint)",
      border: "0",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 2%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--fg) 2%, transparent)" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)",
    },
  },
  // `dark: true` only selects CodeMirror's built-in dark base styles. Since
  // every color above is a token, this no longer needs to track the theme.
  { dark: true },
);

export default function FileEditor(props: {
  projectId: string;
  path: string;
  onDirtyChange: (dirty: boolean) => void;
  onViewDiff: (path: string) => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | null = null;
  const langCompartment = new Compartment();

  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [conflict, setConflict] = createSignal(false);
  const [savedDoc, setSavedDoc] = createSignal<string>("");

  // Whether the file on disk differs from HEAD, so we can offer a "view diff"
  // button. Keyed on a bump counter that we tick whenever the working tree
  // changes under us (save, reload, external edit picked up by the poll).
  const [gitKey, setGitKey] = createSignal(0);
  const [gitStatus] = createResource(
    () => ({ projectId: props.projectId, path: props.path, key: gitKey() }),
    async ({ projectId, path }) => (await fetchGitDiff(projectId, path)).status,
  );
  // "!" is a gitignored file (no diff to HEAD); null means clean. Anything else
  // is a real change worth surfacing a diff for.
  const hasDiff = () => {
    const s = gitStatus();
    return s != null && s !== "!";
  };

  const wrapCompartment = new Compartment();
  const [wrap, setWrap] = createSignal(false);
  const [preview, setPreview] = createSignal(false);
  const [previewText, setPreviewText] = createSignal("");
  const [stats, setStats] = createSignal<EditorStats>({
    kind: "cursor",
    line: 1,
    col: 1,
    lineCount: 1,
  });

  const isMarkdown = () => {
    const m = loaded();
    return m?.kind === "text" && m.language === "markdown";
  };

  const computeStats = (state: EditorState): EditorStats =>
    isMarkdown()
      ? { kind: "markdown", ...markdownStats(state.doc.toString()) }
      : { kind: "cursor", ...cursorStats(state) };

  const isDirty = () => view !== null && view.state.doc.toString() !== savedDoc();

  const performSave = async (overwrite: boolean) => {
    if (!view) return;
    const meta = loaded();
    if (!meta || meta.kind !== "text") return;
    const content = view.state.doc.toString();
    const body = overwrite ? { content } : { content, expectedMtimeMs: meta.mtimeMs };
    try {
      const res = await writeFile(props.projectId, props.path, body);
      if ("error" in res && res.error === "stale") {
        setConflict(true);
        return;
      }
      const ok = res as { path: string; mtimeMs: number; sha: string };
      setLoaded({ kind: "text", mtimeMs: ok.mtimeMs, sha: ok.sha, language: meta.language });
      setSavedDoc(content);
      setConflict(false);
      setGitKey((n) => n + 1);
      props.onDirtyChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reloadFromDisk = async () => {
    try {
      const r = await fetchFile(props.projectId, props.path);
      if (r.kind !== "text" || !view) return;
      setSavedDoc(r.content);
      setLoaded({ kind: "text", mtimeMs: r.mtimeMs, sha: r.sha, language: r.language });
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: r.content },
      });
      setConflict(false);
      setGitKey((n) => n + 1);
      props.onDirtyChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleWrap = () => {
    const next = !wrap();
    setWrap(next);
    view?.dispatch({
      effects: wrapCompartment.reconfigure(next ? EditorView.lineWrapping : []),
    });
  };

  const togglePreview = () => {
    const next = !preview();
    if (next && view) {
      setPreviewText(view.state.doc.toString());
    }
    setPreview(next);
    if (!next && view) {
      // Editor host was display:none while previewing — re-measure on return.
      // Re-check `view` inside the frame: onCleanup nulls it if we unmount first.
      requestAnimationFrame(() => view?.requestMeasure());
    }
  };

  onMount(async () => {
    const owner = getOwner();
    const r = await fetchFile(props.projectId, props.path).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (!r) return;
    if (r.kind !== "text") {
      setLoaded(r);
      return;
    }
    setLoaded({ kind: "text", mtimeMs: r.mtimeMs, sha: r.sha, language: r.language });
    setWrap(r.language === "markdown");
    setSavedDoc(r.content);

    const langExt = await loadLanguageExtension(r.language);

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const dirty = u.state.doc.toString() !== savedDoc();
        props.onDirtyChange(dirty);
      }
      if (u.docChanged || u.selectionSet) {
        setStats(computeStats(u.state));
      }
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          void performSave(false);
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: r.content,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        saveKeymap,
        langCompartment.of(langExt ?? []),
        wrapCompartment.of(wrap() ? EditorView.lineWrapping : []),
        forestTheme,
        syntaxHighlighting(forestHighlight),
        updateListener,
      ],
    });
    view = new EditorView({ state, parent: host });
    setStats(computeStats(view.state));

    // Disk-change poll
    const interval = setInterval(async () => {
      try {
        const fresh = await fetchFile(props.projectId, props.path);
        if (fresh.kind !== "text") return;
        const meta = loaded();
        if (!meta || meta.kind !== "text") return;
        if (fresh.sha === meta.sha && fresh.mtimeMs === meta.mtimeMs) return;
        // The file changed on disk underneath us — its diff-to-HEAD may have too.
        setGitKey((n) => n + 1);
        if (isDirty()) {
          setConflict(true);
        } else if (view) {
          setSavedDoc(fresh.content);
          setLoaded({
            kind: "text",
            mtimeMs: fresh.mtimeMs,
            sha: fresh.sha,
            language: fresh.language,
          });
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: fresh.content },
          });
        }
      } catch {
        // transient — ignore
      }
    }, POLL_MS);

    runWithOwner(owner, () => {
      onCleanup(() => {
        clearInterval(interval);
        view?.destroy();
        view = null;
      });
    });
  });

  return (
    <div class="file-editor">
      <Show when={hasDiff()}>
        <div class="file-editor-bar">
          <button class="panel-retry" onclick={() => props.onViewDiff(props.path)}>
            view diff
          </button>
        </div>
      </Show>
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <Show when={conflict()}>
        <div class="banner banner-error">
          this file was modified on disk —
          <button class="panel-retry" onclick={() => void performSave(true)}>overwrite</button>
          <button class="panel-retry" onclick={() => void reloadFromDisk()}>reload</button>
        </div>
      </Show>
      <Show
        when={loaded()?.kind === "text"}
        fallback={
          <Show when={loaded()}>
            {(l) => (
              <Switch
                fallback={
                  <div class="file-editor-placeholder">
                    <Show when={l().kind === "binary"}>
                      binary file ({(l() as { kind: "binary"; size: number }).size} bytes) — not viewable in forest
                    </Show>
                    <Show when={l().kind === "too-large"}>
                      file too large ({(l() as { kind: "too-large"; size: number }).size} bytes) — open in your editor
                    </Show>
                  </div>
                }
              >
                <Match when={l().kind === "image"}>
                  <ImageViewer
                    src={fileRawUrl(
                      props.projectId,
                      props.path,
                      (l() as { kind: "image"; mtimeMs: number }).mtimeMs,
                    )}
                    alt={props.path}
                  />
                </Match>
                <Match when={l().kind === "pdf"}>
                  <PdfViewer
                    src={fileRawUrl(
                      props.projectId,
                      props.path,
                      (l() as { kind: "pdf"; mtimeMs: number }).mtimeMs,
                    )}
                  />
                </Match>
              </Switch>
            )}
          </Show>
        }
      >
        <>
          <div
            ref={host!}
            class="file-editor-host"
            style={{ display: preview() ? "none" : undefined }}
          />
          <Show when={preview()}>
            <div class="file-editor-preview">
              <Markdown text={previewText()} />
            </div>
          </Show>
          <EditorStatusBar
            stats={stats()}
            isMarkdown={isMarkdown()}
            wrap={wrap()}
            preview={preview()}
            onToggleWrap={toggleWrap}
            onTogglePreview={togglePreview}
          />
        </>
      </Show>
    </div>
  );
}
