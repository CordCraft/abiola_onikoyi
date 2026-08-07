import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import {
  computeStats,
  getDeals,
  getSnapshots,
  getTradingAccount,
  groupTrades,
  type LivePosition,
} from "@/lib/trading/data";
import { daysAgo, formatDuration, isStale, marginStatus } from "@/lib/trading/status";
import { formatDateTime } from "@/lib/format";
import TradingLineChart from "@/components/dashboard/TradingLineChart";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 5 });

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

function pnlClass(v: number) {
  return v >= 0 ? "text-emerald-700" : "text-red-700";
}

export default async function TradingAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string; trades?: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const sp = await searchParams;
  const days = RANGES.some((r) => r.days === Number(sp.days))
    ? Number(sp.days)
    : 30;
  const showAllTrades = sp.trades === "all";

  const account = await getTradingAccount(id);
  if (!account) notFound();

  const since = daysAgo(days);
  const [snapshots, deals] = await Promise.all([
    getSnapshots(account.id, since),
    getDeals(account.id),
  ]);

  const trades = groupTrades(deals);
  const stats = computeStats(trades, deals);
  const closedTrades = trades
    .filter((t) => t.closeTime !== null)
    .sort((a, b) => b.closeTime!.getTime() - a.closeTime!.getTime());
  const visibleTrades = showAllTrades ? closedTrades : closedTrades.slice(0, 50);

  const positions = (account.openPositions ?? []) as LivePosition[];
  const status = marginStatus(account.marginLevel, account.positionCount);
  const stale = isStale(account.lastSeenAt);

  const equitySeries = [
    {
      name: "Equity",
      color: "#2a78d6",
      points: snapshots.map((s) => ({ t: s.at.getTime(), v: s.equity })),
    },
    {
      name: "Balance",
      color: "#eb6834",
      points: snapshots.map((s) => ({ t: s.at.getTime(), v: s.balance })),
    },
  ];

  // Margin level only exists while positions are open; cap the y-scale so a
  // brief tiny position (margin level in the tens of thousands) does not
  // flatten the danger zone out of view.
  const marginPoints = snapshots
    .filter((s) => s.marginLevel !== null)
    .map((s) => ({ t: s.at.getTime(), v: Math.min(s.marginLevel!, 2000) }));
  const lowestMargin = snapshots.reduce<number | null>(
    (min, s) =>
      s.marginLevel === null ? min : min === null ? s.marginLevel : Math.min(min, s.marginLevel),
    null,
  );
  const lowestEquity = snapshots.reduce<number | null>(
    (min, s) => (min === null ? s.equity : Math.min(min, s.equity)),
    null,
  );

  const fmtMoney = (v: number) => `${money.format(v)} ${account.currency}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/trading"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            &larr; All accounts
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            {account.label || account.broker}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            #{account.login} on {account.server}
            {account.leverage ? ` · 1:${account.leverage}` : ""} ·{" "}
            {stale ? (
              <span className="text-red-700">
                offline, last seen {formatDateTime(account.lastSeenAt)}
              </span>
            ) : (
              <span className="text-emerald-700">live</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/dashboard/trading/${account.id}/analytics`}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Analytics
          </Link>
          <span className="flex items-center gap-1.5 rounded-full bg-zinc-50 px-3 py-1.5 text-sm font-medium">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: status.color }}
            />
            <span className={status.text}>
              {status.label}
              {account.marginLevel !== null
                ? `, margin ${Math.round(account.marginLevel)}%`
                : ""}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Equity", value: fmtMoney(account.equity), cls: "text-zinc-900" },
          { label: "Balance", value: fmtMoney(account.balance), cls: "text-zinc-900" },
          {
            label: "Floating P/L",
            value: `${account.floatingPnl >= 0 ? "+" : ""}${fmtMoney(account.floatingPnl)}`,
            cls: pnlClass(account.floatingPnl),
          },
          {
            label: "Free margin",
            value: fmtMoney(account.freeMargin),
            cls: "text-zinc-900",
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400">{tile.label}</div>
            <div
              className={`mt-1 text-xl font-bold ${tile.cls}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">Equity and balance</h2>
          <div className="flex gap-1 text-xs">
            {RANGES.map((r) => (
              <Link
                key={r.days}
                href={`/dashboard/trading/${account.id}?days=${r.days}`}
                className={`rounded-full px-3 py-1 font-medium ${
                  days === r.days
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <TradingLineChart series={equitySeries} currency={account.currency} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
          {lowestEquity !== null && (
            <span>
              Lowest equity in range:{" "}
              <span className="font-medium text-zinc-900">{fmtMoney(lowestEquity)}</span>
            </span>
          )}
          <span>
            The gap between the lines is open-trade drawdown you sat through
            while away.
          </span>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Margin level (stop-out radar)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Recorded every 30 seconds while positions are open. Brokers stop
          accounts out between 0% and 50% margin level, so the danger line
          sits at 100%. Values above 2000% are capped for readability.
        </p>
        <div className="mt-4">
          {marginPoints.length > 1 ? (
            <TradingLineChart
              series={[{ name: "Margin level", color: "#2a78d6", points: marginPoints }]}
              valueFormat="percent"
              referenceLine={{ value: 100, label: "100% danger line", color: "#d03b3b" }}
            />
          ) : (
            <div className="grid h-32 place-items-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400">
              No open-position snapshots in this range yet.
            </div>
          )}
        </div>
        {lowestMargin !== null && (
          <p className="mt-3 text-xs text-zinc-500">
            Closest call in range:{" "}
            <span className="font-medium text-zinc-900">
              {Math.round(lowestMargin)}% margin level
            </span>
            {lowestMargin > 500
              ? ", comfortably clear of any stop-out."
              : lowestMargin > 200
                ? ", worth keeping an eye on."
                : ", uncomfortably close to a stop-out."}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">
          Open positions ({positions.length})
        </h2>
        {positions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Flat right now.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                  <th className="py-2 pr-4 font-medium">Symbol</th>
                  <th className="py-2 pr-4 font-medium">Side</th>
                  <th className="py-2 pr-4 font-medium">Lots</th>
                  <th className="py-2 pr-4 font-medium">Opened</th>
                  <th className="py-2 pr-4 font-medium">Entry</th>
                  <th className="py-2 pr-4 font-medium">Now</th>
                  <th className="py-2 pr-4 font-medium">SL / TP</th>
                  <th className="py-2 text-right font-medium">P/L</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {positions.map((p) => (
                  <tr key={p.ticket} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 font-medium text-zinc-900">{p.symbol}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          p.type === "buy" ? "text-emerald-700" : "text-red-700"
                        }
                      >
                        {p.type}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{num.format(p.volume)}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {formatDateTime(new Date(p.openTime))}
                    </td>
                    <td className="py-2 pr-4">{num.format(p.openPrice)}</td>
                    <td className="py-2 pr-4">{num.format(p.currentPrice)}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {p.sl ? num.format(p.sl) : "-"} / {p.tp ? num.format(p.tp) : "-"}
                    </td>
                    <td className={`py-2 text-right font-medium ${pnlClass(p.profit)}`}>
                      {p.profit >= 0 ? "+" : ""}
                      {money.format(p.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">All-time performance</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              label: "Net profit",
              value: `${stats.netProfit >= 0 ? "+" : ""}${fmtMoney(stats.netProfit)}`,
              cls: pnlClass(stats.netProfit),
            },
            {
              label: "Closed trades",
              value: String(stats.closedCount),
              cls: "text-zinc-900",
            },
            {
              label: "Win rate",
              value: stats.winRate === null ? "-" : `${Math.round(stats.winRate * 100)}%`,
              cls: "text-zinc-900",
            },
            {
              label: "Profit factor",
              value:
                stats.profitFactor === null
                  ? "-"
                  : stats.profitFactor === Infinity
                    ? "99+"
                    : stats.profitFactor.toFixed(2),
              cls: "text-zinc-900",
            },
            {
              label: "Max concurrent trades",
              value: String(stats.maxConcurrent),
              cls: "text-zinc-900",
            },
            {
              label: "Max drawdown (closed)",
              value: `${fmtMoney(stats.maxDrawdown)}${
                stats.maxDrawdownPct !== null
                  ? ` (${(stats.maxDrawdownPct * 100).toFixed(1)}%)`
                  : ""
              }`,
              cls: "text-zinc-900",
            },
            {
              label: "Best / worst trade",
              value:
                stats.bestTrade === null
                  ? "-"
                  : `+${money.format(stats.bestTrade)} / ${money.format(stats.worstTrade ?? 0)}`,
              cls: "text-zinc-900",
            },
            {
              label: "Avg win / avg loss",
              value:
                stats.avgWin === null && stats.avgLoss === null
                  ? "-"
                  : `+${money.format(stats.avgWin ?? 0)} / ${money.format(stats.avgLoss ?? 0)}`,
              cls: "text-zinc-900",
            },
            {
              label: "Avg trade duration",
              value:
                stats.avgDurationSeconds === null
                  ? "-"
                  : formatDuration(stats.avgDurationSeconds),
              cls: "text-zinc-900",
            },
            {
              label: "Deposits / withdrawals",
              value: `${money.format(stats.deposits)} / ${money.format(stats.withdrawals)}`,
              cls: "text-zinc-900",
            },
          ].map((tile) => (
            <div key={tile.label}>
              <div className="text-xs uppercase tracking-wide text-zinc-400">
                {tile.label}
              </div>
              <div
                className={`mt-1 font-semibold ${tile.cls}`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">
            Trade backlog ({closedTrades.length} closed)
          </h2>
          {closedTrades.length > 50 && (
            <Link
              href={
                showAllTrades
                  ? `/dashboard/trading/${account.id}?days=${days}`
                  : `/dashboard/trading/${account.id}?days=${days}&trades=all`
              }
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              {showAllTrades ? "Show recent 50" : "Show all"}
            </Link>
          )}
        </div>
        {visibleTrades.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No closed trades synced yet. History backfills automatically once
            the Reporter EA is running.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                  <th className="py-2 pr-4 font-medium">Closed</th>
                  <th className="py-2 pr-4 font-medium">Symbol</th>
                  <th className="py-2 pr-4 font-medium">Side</th>
                  <th className="py-2 pr-4 font-medium">Lots</th>
                  <th className="py-2 pr-4 font-medium">Entry &rarr; Exit</th>
                  <th className="py-2 pr-4 font-medium">Held</th>
                  <th className="py-2 pr-4 font-medium">Algo</th>
                  <th className="py-2 text-right font-medium">Net P/L</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {visibleTrades.map((t) => (
                  <tr key={t.positionId} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 text-zinc-500">
                      {formatDateTime(t.closeTime!)}
                    </td>
                    <td className="py-2 pr-4 font-medium text-zinc-900">{t.symbol}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          t.direction === "buy" ? "text-emerald-700" : "text-red-700"
                        }
                      >
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{num.format(t.volume)}</td>
                    <td className="py-2 pr-4">
                      {num.format(t.openPrice)} &rarr;{" "}
                      {t.closePrice !== null ? num.format(t.closePrice) : "-"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {t.durationSeconds !== null ? formatDuration(t.durationSeconds) : "-"}
                    </td>
                    <td
                      className="max-w-40 truncate py-2 pr-4 text-xs text-zinc-500"
                      title={`${t.comment ?? ""}${t.magic ? ` (magic ${t.magic})` : ""}`}
                    >
                      {t.comment || (t.magic ? `magic ${t.magic}` : "-")}
                    </td>
                    <td className={`py-2 text-right font-medium ${pnlClass(t.profit)}`}>
                      {t.profit >= 0 ? "+" : ""}
                      {money.format(t.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
