import { createSignal, createMemo, createEffect, For, Show, untrack } from "solid-js";
import { fetchTreeChildren, revealInFinder } from "../api";
import type { TreeEntry, GitFileStatus } from "../api";
import { loadExpandedDirs, saveExpandedDirs } from "../lib/tabs";

type Node = {
  name: string;
  path: string;
  type: "file" | "dir";
  gitStatus: GitFileStatus | null;
  children: Node[];
};

function buildTree(entries: TreeEntry[]): Node {
  const root: Node = {
    name: "",
    path: "",
    type: "dir",
    gitStatus: null,
    children: [],
  };
  const byPath = new Map<string, Node>([["", root]]);

  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  // The entry list merges the server tree with lazily-fetched children, so the same
  // path can arrive from both sources. Render it once: first wins, which is the
  // server entry (it sorts ahead of lazy ones and carries the real git status).
  const seen = new Set<string>();

  for (const e of sorted) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const parts = e.path.split("/");
    const name = parts[parts.length - 1]!;
    const parentPath = parts.slice(0, -1).join("/");
    const parent = byPath.get(parentPath) ?? root;
    const node: Node = {
      name,
      path: e.path,
      type: e.type,
      gitStatus: e.gitStatus ?? null,
      children: [],
    };
    parent.children.push(node);
    if (e.type === "dir") byPath.set(e.path, node);
  }
  return root;
}

function buildDirtyDirs(entries: TreeEntry[]): Set<string> {
  const set = new Set<string>();
  for (const e of entries) {
    // "!" (gitignored) doesn't make a parent dir dirty — ignored content isn't a change.
    if (e.type !== "file" || !e.gitStatus || e.gitStatus === "!") continue;
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      set.add(parts.slice(0, i).join("/"));
    }
  }
  return set;
}

export default function FileTreePanel(props: {
  projectId: string;
  projectPath?: string;
  entries: TreeEntry[];
  highlightedPaths: string[];
  onOpenFile: (path: string) => void;
  onOpenFileRight: (path: string) => void;
}) {
  const [expanded, setExpanded] = createSignal<Set<string>>(
    new Set(loadExpandedDirs(props.projectId)),
  );
  // Children of gitignored dirs, fetched on demand. Folded into the tree
  // alongside props.entries. loadedDirs/loadingDirs/errorDirs dedupe fetches
  // and drive the Loading / retry rows.
  const [lazyEntries, setLazyEntries] = createSignal<TreeEntry[]>([]);
  const [loadedDirs, setLoadedDirs] = createSignal<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = createSignal<Set<string>>(new Set());
  const [errorDirs, setErrorDirs] = createSignal<Set<string>>(new Set());

  const allEntries = createMemo(() => [...props.entries, ...lazyEntries()]);
  const tree = createMemo(() => buildTree(allEntries()));
  const dirtyDirs = createMemo(() => buildDirtyDirs(props.entries));

  const ensureLoaded = async (path: string) => {
    if (untrack(loadedDirs).has(path) || untrack(loadingDirs).has(path)) return;
    setLoadingDirs((s) => new Set(s).add(path));
    setErrorDirs((s) => {
      const n = new Set(s);
      n.delete(path);
      return n;
    });
    try {
      const { entries } = await fetchTreeChildren(props.projectId, path);
      setLazyEntries((e) => [...e, ...entries]);
      setLoadedDirs((s) => new Set(s).add(path));
    } catch {
      setErrorDirs((s) => new Set(s).add(path));
    } finally {
      setLoadingDirs((s) => {
        const n = new Set(s);
        n.delete(path);
        return n;
      });
    }
  };

  // Whenever a gitignored ("!") directory is expanded, ensure its children
  // have been fetched. This single effect covers interactive expansion,
  // expansion restored from localStorage on mount, and nested drilling —
  // children of an ignored dir are themselves "!" dirs, so as each level
  // lands in lazyEntries the effect re-runs and loads the next.
  createEffect(() => {
    const exp = expanded();
    for (const e of allEntries()) {
      if (e.type === "dir" && e.gitStatus === "!" && exp.has(e.path)) {
        void ensureLoaded(e.path);
      }
    }
  });

  const toggle = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
    saveExpandedDirs(props.projectId, [...next]);
  };

  const onFileClick = (node: Node, e: MouseEvent) => {
    // Clicking any file — changed or not — opens it in the editor. A changed
    // file surfaces its own "view diff" button in the editor header; the diff
    // is no longer the default. Alt-click still pins the file to the right pane.
    if (e.altKey) props.onOpenFileRight(node.path);
    else props.onOpenFile(node.path);
  };

  // Hover actions on every row. They stop propagation so a click doesn't also
  // toggle the dir / open the file underneath.
  function RowActions(p: { path: string }) {
    const [copied, setCopied] = createSignal(false);
    const onCopy = (e: MouseEvent) => {
      e.stopPropagation();
      const root = props.projectPath;
      if (!root) return;
      void navigator.clipboard?.writeText(`${root.replace(/\/+$/, "")}/${p.path}`).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    };
    const onReveal = (e: MouseEvent) => {
      e.stopPropagation();
      revealInFinder(props.projectId, p.path).catch((err) => window.alert((err as Error).message));
    };
    return (
      <span class="tree-actions">
        <Show when={props.projectPath}>
          <button
            class="tree-action"
            title={copied() ? "Copied" : "Copy absolute path"}
            aria-label="Copy absolute path"
            onclick={onCopy}
          >
            <Show
              when={copied()}
              fallback={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </Show>
          </button>
        </Show>
        <button class="tree-action" title="Open in Finder" aria-label="Open in Finder" onclick={onReveal}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </button>
      </span>
    );
  }

  function NodeRow(p: { node: Node; depth: number }): any {
    const indent = { "padding-left": `${p.node.path === "" ? 0 : p.depth * 12}px` };
    const childIndent = { "padding-left": `${(p.depth + 1) * 12}px` };
    return (
      <Show
        when={p.node.path !== ""}
        fallback={<For each={p.node.children}>{(c) => <NodeRow node={c} depth={0} />}</For>}
      >
        <Show
          when={p.node.type === "dir"}
          fallback={
            <div
              class={`tree-row tree-file ${
                props.highlightedPaths.includes(p.node.path) ? "tree-file-active" : ""
              } ${p.node.gitStatus ? `tree-file-${p.node.gitStatus}` : ""}`}
              style={indent}
              onclick={(e) => onFileClick(p.node, e)}
            >
              <span class={`tree-badge ${p.node.gitStatus ? `tree-badge-${p.node.gitStatus}` : ""}`}>
                {p.node.gitStatus ?? ""}
              </span>
              <span class="tree-file-name">{p.node.name}</span>
              <RowActions path={p.node.path} />
            </div>
          }
        >
          <div
            class={`tree-row tree-dir ${dirtyDirs().has(p.node.path) ? "tree-dir-dirty" : ""}`}
            style={indent}
            onclick={() => toggle(p.node.path)}
          >
            <span class="tree-dir-name">
              {expanded().has(p.node.path) ? "▾" : "▸"} {p.node.name}
            </span>
            <RowActions path={p.node.path} />
          </div>
          <Show when={expanded().has(p.node.path)}>
            <For each={p.node.children}>{(c) => <NodeRow node={c} depth={p.depth + 1} />}</For>
            <Show when={p.node.gitStatus === "!" && loadingDirs().has(p.node.path)}>
              <div class="tree-row tree-lazy-status" style={childIndent}>
                Loading…
              </div>
            </Show>
            <Show when={p.node.gitStatus === "!" && errorDirs().has(p.node.path)}>
              <div
                class="tree-row tree-lazy-error"
                style={childIndent}
                onclick={() => ensureLoaded(p.node.path)}
              >
                Failed to load — retry
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    );
  }

  return (
    <div class="file-tree">
      <NodeRow node={tree()} depth={0} />
    </div>
  );
}
