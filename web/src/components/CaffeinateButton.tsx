import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchCaffeinateStatus, startCaffeinate, stopCaffeinate, type CaffeinateStatus } from "../api";

const DURATIONS: Array<{ label: string; durationSec: number | null }> = [
  { label: "1 hour", durationSec: 3600 },
  { label: "2 hours", durationSec: 7200 },
  { label: "4 hours", durationSec: 14400 },
  { label: "8 hours", durationSec: 28800 },
  { label: "Indefinite", durationSec: null },
];

const POLL_MS = 30_000;
const ERROR_MS = 3_000;

function formatRemaining(endsAt: number): string {
  const ms = Math.max(0, endsAt - Date.now());
  // ceil so that a freshly-started 90-minute timer reads "1h 30m", not "1h 29m"
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function tooltipFor(status: CaffeinateStatus | null): string {
  if (!status || !status.active) return "keep awake";
  if (status.indefinite) return "caffeinated — indefinite";
  if (status.endsAt !== null) return `caffeinated — ${formatRemaining(status.endsAt)} remaining`;
  return "caffeinated";
}

export default function CaffeinateButton() {
  const [status, setStatus] = createSignal<CaffeinateStatus | null>(null);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let rootRef: HTMLDivElement | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh(): Promise<void> {
    try {
      setStatus(await fetchCaffeinateStatus());
    } catch (err) {
      flashError((err as Error).message);
    }
  }

  function flashError(msg: string): void {
    setError(msg);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => setError(null), ERROR_MS);
  }

  async function handleClick(): Promise<void> {
    const s = status();
    if (!s) return;
    if (s.active) {
      try {
        setStatus(await stopCaffeinate());
      } catch (err) {
        flashError((err as Error).message);
      }
    } else {
      setMenuOpen(!menuOpen());
    }
  }

  async function pick(durationSec: number | null): Promise<void> {
    setMenuOpen(false);
    try {
      setStatus(await startCaffeinate(durationSec));
    } catch (err) {
      flashError((err as Error).message);
    }
  }

  const onDocClick = (e: MouseEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) setMenuOpen(false);
  };

  onMount(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, POLL_MS);
    document.addEventListener("click", onDocClick);
    onCleanup(() => {
      clearInterval(poll);
      document.removeEventListener("click", onDocClick);
      if (errorTimer) clearTimeout(errorTimer);
    });
  });

  return (
    <Show when={status()?.supported}>
      <div class="caffeinate" ref={rootRef}>
        <button
          class={`caffeinate-button ${status()?.active ? "caffeinate-on" : "caffeinate-off"}`}
          title={error() ?? tooltipFor(status())}
          onclick={handleClick}
          aria-label={tooltipFor(status())}
        >
          {/* Inline coffee-cup SVG so the component has no asset dependency. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 8h14v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z" />
            <path d="M18 9h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2" />
            <path d="M7 4c0 1.5 1 2 1 3.5M11 4c0 1.5 1 2 1 3.5M15 4c0 1.5 1 2 1 3.5" />
          </svg>
          <Show when={error()}>
            <span class="caffeinate-error-dot" aria-hidden="true" />
          </Show>
        </button>
        <Show when={menuOpen() && !status()?.active}>
          <div class="caffeinate-menu">
            <For each={DURATIONS}>
              {(d) => (
                <button
                  class="caffeinate-menu-item"
                  onclick={() => { void pick(d.durationSec); }}
                >
                  {d.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
