import { createSignal, createMemo, createEffect, For, Show, untrack } from "solid-js";
import { fetchTreeChildren } from "../api";
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

  for (const e of sorted) {
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
  entries: TreeEntry[];
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
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

  const onFileClick = (node: Node) => {
    // "!" marks a gitignored file — open it normally; ignored files have no diff.
    if (node.gitStatus && node.gitStatus !== "!") props.onOpenDiff(node.path);
    else props.onOpenFile(node.path);
  };

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
                props.activeFilePath === p.node.path ? "tree-file-active" : ""
              } ${p.node.gitStatus ? `tree-file-${p.node.gitStatus}` : ""}`}
              style={indent}
              onclick={() => onFileClick(p.node)}
            >
              <span class={`tree-badge ${p.node.gitStatus ? `tree-badge-${p.node.gitStatus}` : ""}`}>
                {p.node.gitStatus ?? ""}
              </span>
              <span class="tree-file-name">{p.node.name}</span>
            </div>
          }
        >
          <div
            class={`tree-row tree-dir ${dirtyDirs().has(p.node.path) ? "tree-dir-dirty" : ""}`}
            style={indent}
            onclick={() => toggle(p.node.path)}
          >
            {expanded().has(p.node.path) ? "▾" : "▸"} {p.node.name}
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
