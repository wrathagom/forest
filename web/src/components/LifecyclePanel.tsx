import { Show, createResource, createSignal, createMemo, createEffect, on, onCleanup } from "solid-js";
import { fetchLifecycle, setLifecycleEnabled, startLifecycle, stopLifecycle, startSection, stopSection } from "../api";
import type { LifecycleStatus, LifecycleRunResult, LifecycleView } from "../api";
import { lifecycleTone, isLifecycleUp } from "../lib/dashboard-view";
import OverflowRow, { type OverflowPlace } from "./OverflowRow";
import Popover from "./Popover";

const POLL_FAST_MS = 1_000;
const POLL_SLOW_MS = 10_000;

export type LifecycleLastRun = {
  output: string;
  failed: boolean;
  at: number;
  /** True when this run was already present when the project's view first loaded. */
  stale: boolean;
};

/** One unit on the lifecycle line: the top level (key "") or a named section. */
export type LifecycleGroup = {
  key: string;
  name: string | null;
  status: LifecycleStatus;
  showChip: boolean;
  url?: string;
  showLink: boolean;
  canStart: boolean;
  canStop: boolean;
  onStart: () => void;
  onStop: () => void;
  lastRun: LifecycleLastRun | null;
  /** Top level only: what to show instead of controls when not enabled. */
  gate?: "no-config" | "enable";
  onEnable?: () => void;
};

/** Last-run timestamps per group key, used to tell a stale failure from a new one. */
function runStamps(v: LifecycleView): Record<string, number> {
  const out: Record<string, number> = {};
  if (v.lastRun) out[""] = v.lastRun.at;
  for (const s of v.sections ?? []) if (s.lastRun) out[s.name] = s.lastRun.at;
  return out;
}

function toLastRun(
  run: { output: string; failed: boolean; at: number } | null,
  baseline: number | undefined,
): LifecycleLastRun | null {
  if (!run || !run.output) return null;
  return { output: run.output, failed: run.failed, at: run.at, stale: baseline === run.at };
}

export default function LifecyclePanel(props: { projectId: string }) {
  // Snapshot of each project's last-run timestamps from its first fetch. A
  // failed run auto-opens its popover only when it is newer than this — a
  // stale failure from an earlier visit just tints the trigger.
  const baselines = new Map<string, Record<string, number>>();
  const [data, { refetch }] = createResource(() => props.projectId, async (id) => {
    const v = await fetchLifecycle(id);
    if (!baselines.has(id)) baselines.set(id, runStamps(v));
    return v;
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Optimistic status shown the instant a command is clicked, before the first
  // poll observes the server's transient state. Cleared when the command ends.
  const [pending, setPending] = createSignal<LifecycleStatus | null>(null);
  // Per-section optimistic status, keyed by section name.
  const [sectionPending, setSectionPending] = createSignal<Record<string, LifecycleStatus>>({});

  // Reset per-project local state when navigating between projects so a banner
  // from one project can't bleed into the next.
  createEffect((prev: string | undefined) => {
    const id = props.projectId;
    if (prev !== undefined && prev !== id) {
      setError(null);
      setPending(null);
      setSectionPending({});
    }
    return id;
  });

  const displayStatus = (): LifecycleStatus | undefined => pending() ?? data()?.status;
  const isTransient = (s: LifecycleStatus | undefined) => s === "starting" || s === "stopping";

  // Poll the (cheap) lifecycle endpoint so status updates live without a manual
  // refresh: fast while a command is in flight or the status is transient, slow
  // otherwise. Skip entirely for a project with no forest.yaml — its lifecycle
  // status can't change through Forest. Both gates are memos so the interval is
  // recreated only when the cadence (or the should-poll gate) flips, not on
  // every poll.
  const shouldPoll = createMemo(() => busy() || !!data()?.hasConfig);
  const anySectionTransient = createMemo(() => {
    const secs = data()?.sections ?? [];
    const pend = sectionPending();
    return secs.some((s) => isTransient(pend[s.name] ?? s.status));
  });
  const fast = createMemo(() => busy() || isTransient(displayStatus()) || anySectionTransient());
  createEffect(() => {
    if (!shouldPoll()) return;
    const ms = fast() ? POLL_FAST_MS : POLL_SLOW_MS;
    const t = setInterval(() => void refetch(), ms);
    onCleanup(() => clearInterval(t));
  });

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await setLifecycleEnabled(props.projectId, true);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Last-run output is not kept locally: `refetch()` right after the run
  // brings the server's record, which is the single source for every group.
  const run = async (kind: "start" | "stop", fn: (id: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setPending(kind === "start" ? "starting" : "stopping");
    try {
      await fn(props.projectId);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const runSection = async (name: string, kind: "start" | "stop", fn: (id: string, section: string) => Promise<LifecycleRunResult>) => {
    setBusy(true);
    setError(null);
    setSectionPending((p) => ({ ...p, [name]: kind === "start" ? "starting" : "stopping" }));
    try {
      await fn(props.projectId, name);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionPending((p) => { const { [name]: _drop, ...rest } = p; return rest; });
      setBusy(false);
    }
  };

  const groups = createMemo<LifecycleGroup[]>(() => {
    const d = data();
    if (!d) return [];
    const base = baselines.get(props.projectId) ?? {};
    const topStatus = pending() ?? d.status;
    const top: LifecycleGroup = {
      key: "",
      name: null,
      status: topStatus,
      showChip: true,
      url: d.config?.url,
      showLink: !!d.config?.url && isLifecycleUp(topStatus),
      canStart: d.enabled && !!d.config?.start,
      canStop: d.enabled && !!d.config?.stop,
      onStart: () => void run("start", startLifecycle),
      onStop: () => void run("stop", stopLifecycle),
      lastRun: toLastRun(d.lastRun, base[""]),
      gate: !d.hasConfig ? "no-config" : !d.enabled ? "enable" : undefined,
      onEnable: () => void enable(),
    };
    if (!d.enabled) return [top];
    const pend = sectionPending();
    const sections = (d.sections ?? []).map((s): LifecycleGroup => {
      const status = pend[s.name] ?? s.status;
      return {
        key: s.name,
        name: s.name,
        status,
        showChip: status !== "none",
        url: s.config.url,
        // A health section links only while up; a launcher (no health) has no
        // up signal, so its link is a plain convenience whenever a url exists.
        showLink: !!s.config.url && (s.config.health ? isLifecycleUp(status) : true),
        canStart: !!s.config.start,
        canStop: !!s.config.stop,
        onStart: () => void runSection(s.name, "start", startSection),
        onStop: () => void runSection(s.name, "stop", stopSection),
        lastRun: toLastRun(s.lastRun, base[s.name]),
      };
    });
    return [top, ...sections];
  });

  return (
    <div class="lifecycle-panel">
      <Show when={error()}>
        <div class="banner banner-error">{error()}</div>
      </Show>
      <Show when={data.error}>
        <div class="banner banner-error">{(data.error as Error).message}</div>
      </Show>
      <Show when={data.loading && !data()}>
        <span class="muted">lifecycle…</span>
      </Show>
      <Show when={data()}>
        {/* Keyed on the project id so per-group UI state (open popovers) resets
            on navigation, while polls of the same project keep it. */}
        <Show when={props.projectId} keyed>
          {(_id) => (
            <OverflowRow
              items={groups()}
              separator={() => <span class="lifecycle-sep" />}
              menuLabel="more lifecycle controls"
              menuAlert={(hidden) => hidden.some((g) => g.lastRun?.failed === true)}
            >
              {(group, place) => <LifecycleGroupView group={group()} place={place} busy={busy()} />}
            </OverflowRow>
          )}
        </Show>
      </Show>
    </div>
  );
}

function LifecycleGroupView(props: { group: LifecycleGroup; place: OverflowPlace; busy: boolean }) {
  const g = () => props.group;
  const label = () => g().name ?? "lifecycle";
  const chipTitle = () => (g().name ? `${g().name} lifecycle` : "forest.yaml lifecycle");
  const controls = (
    <>
      <Show when={g().showChip}>
        <span class={`chip chip-${lifecycleTone(g().status)}`} title={chipTitle()}>{g().status}</span>
      </Show>
      <Show when={g().gate === "no-config"}>
        <span class="muted">No <code>forest.yaml</code> — add one with <code>start</code>/<code>stop</code>/<code>health</code> to enable lifecycle controls.</span>
      </Show>
      <Show when={g().gate === "enable"}>
        <button class="lifecycle-btn" disabled={props.busy} onclick={() => g().onEnable?.()}>Enable lifecycle</button>
      </Show>
      <Show when={g().showLink}>
        <a class="lifecycle-link" href={g().url} target="_blank" rel="noopener noreferrer">Open ↗</a>
      </Show>
      <Show when={g().canStart}>
        <button class="lifecycle-btn" disabled={props.busy} aria-label={g().name ? `Start ${g().name}` : undefined} onclick={() => g().onStart()}>Start</button>
      </Show>
      <Show when={g().canStop}>
        <button class="lifecycle-btn" disabled={props.busy} aria-label={g().name ? `Stop ${g().name}` : undefined} onclick={() => g().onStop()}>Stop</button>
      </Show>
      <Show when={g().lastRun}>
        {(lr) => <LastRunButton lastRun={lr()} label={label()} interactive={props.place !== "measure"} />}
      </Show>
    </>
  );
  const name = (
    <Show when={g().name}>
      <span class="lifecycle-section-name">{g().name}</span>
    </Show>
  );
  // `place` is fixed for the life of an instance, so a plain ternary (not a
  // reactive <Show>) picks the layout once.
  return props.place === "menu" ? (
    <div class="lifecycle-group menu">
      {name}
      <div class="lifecycle-group-controls">{controls}</div>
    </div>
  ) : (
    <div class="lifecycle-group">
      {name}
      {controls}
    </div>
  );
}

function LastRunButton(props: { lastRun: LifecycleLastRun; label: string; interactive: boolean }) {
  const cls = () => `lifecycle-lastrun${props.lastRun.failed ? " failed" : ""}`;
  // The measuring copy only needs the trigger's size — no popover, no effects.
  if (!props.interactive) {
    return <button type="button" class={cls()} tabindex="-1">last run</button>;
  }
  const [open, setOpen] = createSignal(false);
  // Auto-open when a new failed run lands. `on` fires on every poll (the
  // resource is a fresh object each time), so compare the timestamp to avoid
  // re-opening a popover the user already dismissed. A run that was already
  // there when the project loaded (`stale`) only tints the trigger.
  createEffect(on(() => props.lastRun.at, (at, prev) => {
    if (at !== prev && props.lastRun.failed && !props.lastRun.stale) setOpen(true);
  }));
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      panelClass="lifecycle-lastrun-panel"
      trigger={(t) => (
        <button
          type="button"
          class={cls()}
          ref={t.ref}
          aria-label={`${props.label} last run`}
          aria-expanded={t.expanded()}
          onclick={t.toggle}
        >
          last run
        </button>
      )}
    >
      <pre>{props.lastRun.output}</pre>
    </Popover>
  );
}
