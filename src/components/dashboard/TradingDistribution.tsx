import type { Bucket } from "@/lib/trading/analytics";

// Diverging bars for a set of buckets: profit to the right of the centre line,
// losses to the left, bar length proportional to the largest absolute net in
// the set. Server rendered, no client JS.

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function TradingDistribution({
  title,
  caption,
  buckets,
  emptyLabel = "No closed trades yet.",
}: {
  title: string;
  caption?: string;
  buckets: Bucket[];
  emptyLabel?: string;
}) {
  const maxAbs = Math.max(1e-9, ...buckets.map((b) => Math.abs(b.net)));

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {caption ? <p className="mt-0.5 text-xs text-zinc-500">{caption}</p> : null}
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {buckets.map((b) => {
            const pct = (Math.abs(b.net) / maxAbs) * 50;
            const positive = b.net >= 0;
            return (
              <li key={b.key} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 truncate text-zinc-600" title={b.label}>
                  {b.label}
                </span>
                <span className="relative h-4 flex-1 rounded bg-zinc-50">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-zinc-200" />
                  <span
                    className={`absolute inset-y-0.5 rounded-sm ${
                      positive ? "bg-emerald-500/70" : "bg-red-500/70"
                    }`}
                    style={
                      positive
                        ? { left: "50%", width: `${pct}%` }
                        : { right: "50%", width: `${pct}%` }
                    }
                  />
                </span>
                <span
                  className="w-24 shrink-0 text-right font-medium tabular-nums text-zinc-900"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  <span className={positive ? "text-emerald-700" : "text-red-700"}>
                    {positive ? "+" : ""}
                    {money.format(b.net)}
                  </span>
                </span>
                <span className="w-20 shrink-0 text-right text-zinc-500">
                  {b.trades} {b.trades === 1 ? "trade" : "trades"}
                </span>
                <span className="w-12 shrink-0 text-right text-zinc-500">
                  {b.winRate === null ? "" : `${Math.round(b.winRate * 100)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
