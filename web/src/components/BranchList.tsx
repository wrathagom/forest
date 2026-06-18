import { createSignal, createEffect, onCleanup, For, Show, untrack } from "solid-js";
import type { GitBranch, GitBranchesResponse } from "../api";
import { fetchGitBranches } from "../api";

const POLL_MS = 30_000;

export type BranchListFetcher = () => Promise<GitBranchesResponse>;

export default function BranchList(props: {
  projectId: string;
  enabled: () => boolean;
  selected: () => string | null;
  onSelect: (branch: string) => void;
  /** Optional override — tests substitute a stub. */
  fetcher?: BranchListFetcher;
  /** Bump to force a refresh (the panel's shared refresh button). */
  refreshToken?: () => number;
}) {
  const fetcher: BranchListFetcher =
    props.fetcher ?? (() => fetchGitBranches(props.projectId));

  const [branches, setBranches] = createSignal<GitBranch[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const refresh = async () => {
    if (loading()) return;
    setLoading(true);
    try {
      const r = await fetcher();
      setBranches(r.branches);
      setError(null);
      setLoaded(true);
      // Auto-select base on first load, or fall back to base if the
      // previously selected branch has disappeared from the list.
      const current = props.selected();
      const knownNames = new Set(r.branches.map((b) => b.name));
      if (r.base && (current === null || !knownNames.has(current))) {
        props.onSelect(r.base);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    props.refreshToken?.(); // tracked: re-runs refresh when the panel asks
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!props.enabled()) return;
    untrack(() => void refresh());
    timer = setInterval(() => void refresh(), POLL_MS);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  return (
    <div class="git-branches">
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <Show when={loaded() && branches().length === 0 && !error()}>
        <div class="muted">no branches</div>
      </Show>
      <ul class="git-branch-list">
        <For each={branches()}>
          {(b) => (
            <li
              class={`git-branch ${props.selected() === b.name ? "active" : ""}`}
              onclick={() => props.onSelect(b.name)}
            >
              <span class="git-branch-mark">
                {props.selected() === b.name ? "●" : "○"}
              </span>
              <span class="git-branch-name">{b.name}</span>
              <span class="git-branch-badges">
                <Show when={b.ahead > 0}>
                  <span class="git-branch-ahead">{"↑"}{b.ahead}</span>
                </Show>
                <Show when={b.behind > 0}>
                  <span class="git-branch-behind">{"↓"}{b.behind}</span>
                </Show>
                <Show when={b.hasWorktree}>
                  <span class="git-branch-worktree" title={b.worktreePath ?? ""}>
                    {"⎿"}
                  </span>
                </Show>
                <Show when={b.dirty === true}>
                  <span class="git-branch-dirty" title="uncommitted changes">
                    {"•"}
                  </span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
