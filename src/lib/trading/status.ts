// Margin level classification, shown with a label so color never carries the
// meaning alone. Thresholds are conservative for retail FX stop-outs (brokers
// stop out between 0% and 50% margin level; below 200% is already close).
export function marginStatus(level: number | null, positions: number) {
  if (positions === 0 || level === null)
    return { label: "Flat", color: "#898781", text: "text-zinc-500" };
  if (level < 200) return { label: "Danger", color: "#d03b3b", text: "text-red-700" };
  if (level < 500) return { label: "Watch", color: "#fab219", text: "text-amber-600" };
  return { label: "Healthy", color: "#0ca30c", text: "text-emerald-700" };
}

// The EA posts every 30 seconds; three minutes of silence means the terminal
// or the EA is down.
export function isStale(lastSeenAt: Date): boolean {
  return Date.now() - lastSeenAt.getTime() > 3 * 60_000;
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
