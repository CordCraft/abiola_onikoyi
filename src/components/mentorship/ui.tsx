import type { ReactNode } from "react";

// Small presentational building blocks shared by the mentee portal pages.
// Server-safe: no client hooks.

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-6 ${className}`}>{children}</div>
  );
}

export function CardTitle({
  kicker,
  title,
  action,
}: {
  kicker?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        {kicker ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            {kicker}
          </p>
        ) : null}
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="glass glow-card rounded-2xl p-5">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-700"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">
      {children}
    </p>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "green" | "amber" | "red";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/[0.06] text-zinc-300",
    accent: "bg-accent/10 text-accent",
    green: "bg-emerald-500/10 text-emerald-300",
    amber: "bg-amber-500/10 text-amber-300",
    red: "bg-red-500/10 text-red-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
