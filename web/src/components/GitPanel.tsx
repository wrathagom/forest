import { createSignal, createEffect, onCleanup, For, Show, untrack } from "solid-js";
import type { GitLogCommit, GitLogResponse } from "../api";
import { fetchGitLog } from "../api";
import BranchList from "./BranchList";
import type { BranchListFetcher } from "./BranchList";
import RelativeTime from "./RelativeTime";

const POLL_MS = 30_000;
const PAGE_LIMIT = 50;

export type GitPanelFetcher = (
  args: { before?: string; ref?: string },
) => Promise<GitLogResponse>;

export default function GitPanel(props: {
  projectId: string;
  enabled: () => boolean;
  onOpenCommit: (sha: string) => void;
  /**
   * Optional overrides — when omitted, the real API clients are used.
   * Provided in tests so stubs can be substituted.
   */
  fetcher?: GitPanelFetcher;
  branchesFetcher?: BranchListFetcher;
}) {
  const fetcher: GitPanelFetcher =
    props.fetcher ??
    ((args) =>
      fetchGitLog(props.projectId, {
        limit: PAGE_LIMIT,
        before: args.before,
        ref: args.ref,
      }));

  const [selectedBranch, setSelectedBranch] = createSignal<string | null>(null);
  const [commits, setCommits] = createSignal<GitLogCommit[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [fetchedAt, setFetchedAt] = createSignal<number | null>(null);
  const [refreshNonce, setRefreshNonce] = createSignal(0);

  const refresh = async () => {
    if (loading()) return;
    const ref = selectedBranch();
    if (!ref) return;
    setLoading(true);
    try {
      const r = await fetcher({ ref });
      setCommits(r.commits);
      setHasMore(r.hasMore);
      setFetchedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loading()) return;
    const oldest = commits()[commits().length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const r = await fetcher({
        before: oldest.sha,
        ref: selectedBranch() ?? undefined,
      });
      setCommits([...commits(), ...r.commits]);
      setHasMore(r.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Refresh the commit list whenever the panel is enabled or the selected
  // branch changes; poll while enabled.
  let timer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const on = props.enabled();
    const ref = selectedBranch();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!on || !ref) return;
    untrack(() => void refresh());
    timer = setInterval(() => void refresh(), POLL_MS);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  // The header refresh button refreshes both regions: bumping the nonce
  // triggers BranchList's effect, while the direct refresh() call drives
  // the commit list (the createEffect above only fires when selectedBranch
  // actually changes, so it won't refire on a no-op refresh).
  const refreshAll = () => {
    setRefreshNonce((n) => n + 1);
    void refresh();
  };

  return (
    <div class="git-panel panel-shell">
      <header class="panel-shell-head git-panel-head">
        <span class="panel-shell-title">Git</span>
        <span class="git-panel-fetched muted">
          <Show when={fetchedAt()} fallback={<>—</>}>
            fetched <RelativeTime ms={fetchedAt()} />
          </Show>
        </span>
        <button class="panel-retry" onclick={refreshAll}>refresh</button>
      </header>
      <div class="panel-shell-body">
        <BranchList
          projectId={props.projectId}
          enabled={props.enabled}
          selected={selectedBranch}
          onSelect={setSelectedBranch}
          fetcher={props.branchesFetcher}
          refreshToken={refreshNonce}
        />
        <Show when={error()}>
          <div class="banner banner-error">
            {error()}
            <button class="panel-retry" onclick={() => void refresh()}>retry</button>
          </div>
        </Show>
        <Show when={!fetchedAt() && loading()}>
          <div class="muted">loading…</div>
        </Show>
        <Show when={fetchedAt() && commits().length === 0 && !error()}>
          <div class="muted">no commits</div>
        </Show>
        <ul class="git-commits">
          <For each={commits()}>
            {(c) => (
              <li class="git-commit" onclick={() => props.onOpenCommit(c.sha)}>
                <div class="git-commit-line">
                  <span class="git-commit-sha muted">{c.sha.slice(0, 7)}</span>
                  <span class="git-commit-subject">{c.subject}</span>
                </div>
                <div class="git-commit-meta muted">
                  {c.author} · <RelativeTime ms={c.timestamp} />
                </div>
              </li>
            )}
          </For>
        </ul>
        <Show when={hasMore()}>
          <button class="panel-retry" onclick={() => void loadMore()}>
            load more
          </button>
        </Show>
      </div>
    </div>
  );
}
