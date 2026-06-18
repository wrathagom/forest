import { createSignal, onCleanup } from "solid-js";

function format(ms: number | null): string {
  if (ms === null) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function RelativeTime(props: { ms: number | null }) {
  const [, set] = createSignal(0);
  const t = setInterval(() => set((n) => n + 1), 30_000);
  onCleanup(() => clearInterval(t));
  return <span>{format(props.ms)}</span>;
}
