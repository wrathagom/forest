import type { Tab } from "./tabs";

/**
 * Which tab each pane shows. `activeId` is the left pane and may name any tab
 * kind. `secondaryId` is the right pane and is always a `file:` id or null —
 * only FileEditor can be safely mounted twice in one page, because TerminalView
 * owns a live PTY connection.
 *
 * Invariant: activeId !== secondaryId. That is what guarantees a file never has
 * two CodeMirror views, and therefore never has two dirty flags or two disk
 * pollers fighting each other.
 */
export type PaneState = { activeId: string | null; secondaryId: string | null };

const FILE_PREFIX = "file:";

export function isFileId(id: string | null): id is string {
  return typeof id === "string" && id.startsWith(FILE_PREFIX);
}

/** First tab in display order that is not excluded. Null when none remains. */
function nextTab(tabs: Tab[], exclude: (string | null)[]): string | null {
  const skip = new Set(exclude.filter((x): x is string => x !== null));
  return tabs.find((t) => !skip.has(t.id))?.id ?? null;
}

/** Pin a file tab to the right pane. */
export function splitRight(tabs: Tab[], state: PaneState, fileId: string): PaneState {
  if (!isFileId(fileId)) return state;
  if (!tabs.some((t) => t.id === fileId)) return state;
  if (state.secondaryId === fileId) return state;

  const replacement = nextTab(tabs, [fileId]);
  // Nothing would remain on the left. A split with one file is meaningless, so
  // just open it normally.
  if (replacement === null) return { activeId: fileId, secondaryId: null };

  const activeId = state.activeId === fileId || state.activeId === null ? replacement : state.activeId;
  return { activeId, secondaryId: fileId };
}

/** Click a tab in the strip. Clicking the pinned tab brings it back to the left. */
export function selectTab(state: PaneState, id: string): PaneState {
  if (state.secondaryId === id) return { activeId: id, secondaryId: null };
  return { activeId: id, secondaryId: state.secondaryId };
}

/**
 * Close a tab. `tabs` is the list *before* removal — the caller mutates its
 * store afterwards.
 */
export function closeTab(tabs: Tab[], state: PaneState, id: string): PaneState {
  const secondaryId = state.secondaryId === id ? null : state.secondaryId;
  if (state.activeId !== id) return { activeId: state.activeId, secondaryId };
  return { activeId: nextTab(tabs, [id, secondaryId]), secondaryId };
}

/**
 * Re-establish both invariants against the live tab list. Used after the
 * sessions poll (tabs can vanish when a PTY dies elsewhere) and after loading
 * persisted state.
 */
export function reconcilePanes(tabs: Tab[], state: PaneState): PaneState {
  const ids = new Set(tabs.map((t) => t.id));

  // Order matters: each clause below assumes the ones above it have already run.
  // In particular the stale-pin drop must precede the activeId backfill (which
  // excludes secondaryId), and the only-tab-left promotion must precede the
  // final equality cleanup. Reordering can silently reintroduce the two-editor bug.
  let secondaryId = state.secondaryId;
  if (secondaryId !== null && (!isFileId(secondaryId) || !ids.has(secondaryId))) secondaryId = null;

  let activeId = state.activeId;
  if (activeId !== null && !ids.has(activeId)) activeId = null;
  if (activeId === null) activeId = nextTab(tabs, [secondaryId]);

  // The pinned file is the only tab left: unpin rather than show a blank left pane.
  if (activeId === null && secondaryId !== null) {
    activeId = secondaryId;
    secondaryId = null;
  }
  if (activeId !== null && activeId === secondaryId) secondaryId = null;

  return { activeId, secondaryId };
}
