import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getDeals, getTradingAccount, groupTrades } from "@/lib/trading/data";
import {
  attributionByStep,
  attributionBySymbol,
  attributionByTag,
  attributionByTier,
  buildBalanceTimeline,
  buildClusters,
  buildDistributions,
  buildReturnCurve,
  computeCostDrag,
  inferPointValues,
  rollingWindows,
  summariseR,
  summariseStreaks,
  type AttributionRow,
} from "@/lib/trading/analytics";
import { formatDateTime } from "@/lib/format";
import TradingLineChart from "@/components/dashboard/TradingLineChart";
import TradingDistribution from "@/components/dashboard/TradingDistribution";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num2 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const num3 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });

const RISK_BASES = [0.5, 1, 2] as const;
const ATTRIBUTION_VIEWS = [
  { key: "tier", label: "By tier" },
  { key: "step", label: "By step" },
  { key: "tag", label: "By full tag" },
  { key: "symbol", label: "By symbol" },
] as const;

function pnlClass(v: number) {
  return v >= 0 ? "text-emerald-700" : "text-red-700";
}
function signed(v: number) {
  return `${v >= 0 ? "+" : ""}${money.format(v)}`;
}
function pct(v: number | null, digits = 1) {
  return v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function Tile({
  label,
  value,
  cls = "text-zinc-900",
  hint,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div
        className={`mt-1 text-xl font-bold ${cls}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function AttributionTable({
  rows,
  currency,
  emptyLabel,
}: {
  rows: AttributionRow[];
  currency: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-zinc-400">{emptyLabel}</p>;
  }
  const maxAbsNet = Math.max(1e-9, ...rows.map((r) => Math.abs(r.net)));
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
            <th className="pb-2 font-medium">Group</th>
            <th className="pb-2 text-right font-medium">Trades</th>
            <th className="pb-2 text-right font-medium">Win rate</th>
            <th className="pb-2 text-right font-medium">Gross</th>
            <th className="pb-2 text-right font-medium">Costs</th>
            <th className="pb-2 text-right font-medium">Net</th>
            <th className="pb-2 text-right font-medium">Avg trade</th>
            <th className="pb-2 text-right font-medium">PF</th>
            <th className="pb-2 pl-4 font-medium">Share of net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const width = (Math.abs(r.net) / maxAbsNet) * 100;
            return (
              <tr key={r.key} style={{ fontVariantNumeric: "tabular-nums" }}>
                <td className="py-2 font-medium text-zinc-900">{r.label}</td>
                <td className="py-2 text-right text-zinc-600">{r.trades}</td>
                <td className="py-2 text-right text-zinc-600">
                  {r.winRate === null ? "n/a" : `${Math.round(r.winRate * 100)}%`}
                </td>
                <td className={`py-2 text-right ${pnlClass(r.gross)}`}>{signed(r.gross)}</td>
                <td className="py-2 text-right text-zinc-500">{money.format(r.costs)}</td>
                <td className={`py-2 text-right font-semibold ${pnlClass(r.net)}`}>
                  {signed(r.net)}
                </td>
                <td className={`py-2 text-right ${pnlClass(r.avgTrade)}`}>
                  {signed(r.avgTrade)}
                </td>
                <td className="py-2 text-right text-zinc-600">
                  {r.profitFactor === null ? "n/a" : num2.format(r.profitFactor)}
                </td>
                <td className="py-2 pl-4">
                  <span className="relative block h-3 w-full min-w-[6rem] rounded bg-zinc-50">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-zinc-200" />
                    <span
                      className={`absolute inset-y-0 rounded-sm ${
                        r.net >= 0 ? "bg-emerald-500/70" : "bg-red-500/70"
                      }`}
                      style={
                        r.net >= 0
                          ? { left: "50%", width: `${width / 2}%` }
                          : { right: "50%", width: `${width / 2}%` }
                      }
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-400">All figures in {currency}.</p>
    </div>
  );
}

export default async function TradingAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ risk?: string; by?: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const sp = await searchParams;

  const account = await getTradingAccount(id);
  if (!account) notFound();

  const riskPct = RISK_BASES.includes(Number(sp.risk) as (typeof RISK_BASES)[number])
    ? Number(sp.risk)
    : 1;
  const view = ATTRIBUTION_VIEWS.some((v) => v.key === sp.by) ? sp.by! : "tier";

  const deals = await getDeals(account.id);
  const trades = groupTrades(deals);
  const closed = trades.filter((t) => t.closeTime !== null);

  const pointValues = inferPointValues(trades);
  const timeline = buildBalanceTimeline(deals);
  const clusters = buildClusters(trades, pointValues, timeline);
  const r = summariseR(trades, clusters, deals, riskPct);
  const drag = computeCostDrag(trades);
  const curve = buildReturnCurve(trades, deals);
  const windows = rollingWindows(trades);
  const dist = buildDistributions(trades);
  const streaks = summariseStreaks(trades);

  const attribution =
    view === "step"
      ? attributionByStep(closed)
      : view === "tag"
        ? attributionByTag(closed)
        : view === "symbol"
          ? attributionBySymbol(closed)
          : attributionByTier(closed);

  const returnSeries = [
    {
      name: "Return",
      color: "#2a78d6",
      points: curve.points.map((p) => ({ t: p.t, v: p.returnPct })),
    },
  ];
  const underwaterSeries = [
    {
      name: "Drawdown",
      color: "#d03b3b",
      fill: "rgba(208, 59, 59, 0.16)",
      fillTo: 0,
      points: curve.points.map((p) => ({ t: p.t, v: p.underwaterPct })),
    },
  ];

  const worstGrids = [...clusters]
    .filter((c) => c.mae < 0)
    .sort((a, b) => a.mae - b.mae)
    .slice(0, 8);

  const fmtMoney = (v: number) => `${money.format(v)} ${account.currency}`;
  // A real tag from this account, so the explainer is not a made up example.
  const sampleTag = closed.find((t) => t.comment)?.comment ?? "QQ[XAUUSD]1234[T2/S03]";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/trading/${account.id}`}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            &larr; {account.label || account.broker}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {closed.length} closed trades in {clusters.length} sequences, from{" "}
            {closed.length ? formatDateTime(closed[0].openTime) : "no history yet"}.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Return (deposit adjusted)"
          value={pct(curve.totalReturnPct)}
          cls={curve.totalReturnPct !== null && curve.totalReturnPct >= 0 ? "text-emerald-700" : "text-red-700"}
          hint="Time weighted, so deposits never flatter it"
        />
        <Tile
          label="Max drawdown"
          value={curve.maxDrawdownPct === null ? "n/a" : `${curve.maxDrawdownPct.toFixed(1)}%`}
          cls="text-zinc-900"
          hint={
            curve.maxDrawdownAt
              ? `Deepest on ${formatDateTime(curve.maxDrawdownAt)}`
              : "On closed trades only"
          }
        />
        <Tile
          label="Expectancy"
          value={r.avgR === null ? "n/a" : `${r.avgR >= 0 ? "+" : ""}${num3.format(r.avgR)}R`}
          cls={r.avgR !== null && r.avgR >= 0 ? "text-emerald-700" : "text-red-700"}
          hint={`Risk unit = ${riskPct}% of balance at entry`}
        />
        <Tile
          label="Cost drag"
          value={drag.dragOnGrossWins === null ? "n/a" : `${(drag.dragOnGrossWins * 100).toFixed(1)}%`}
          cls="text-zinc-900"
          hint="Swap plus commission, against gross winnings"
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Deposit adjusted return</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Every closed trade contributes its profit as a fraction of the balance
          that was riding at the time, so paying in more money moves the balance
          without ever moving this line. Deposits {fmtMoney(curve.deposits)},
          withdrawals {fmtMoney(Math.abs(curve.withdrawals))}.
        </p>
        <div className="mt-4">
          <TradingLineChart series={returnSeries} valueFormat="percent" />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Underwater plot</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Distance below the previous high water mark. Flat at zero means new
          highs; the depth and the width of each dip are what a losing stretch
          actually feels like.
        </p>
        <div className="mt-4">
          <TradingLineChart series={underwaterSeries} valueFormat="percent" />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
          <span>
            Currently{" "}
            <span className="font-medium text-zinc-900">
              {curve.currentDrawdownPct === null
                ? "n/a"
                : `${curve.currentDrawdownPct.toFixed(2)}% below peak`}
            </span>
          </span>
          {curve.longestUnderwaterDays !== null && (
            <span>
              Longest stretch below a peak:{" "}
              <span className="font-medium text-zinc-900">
                {num2.format(curve.longestUnderwaterDays)} days
              </span>
            </span>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">Attribution</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            {ATTRIBUTION_VIEWS.map((v) => (
              <Link
                key={v.key}
                href={`/dashboard/trading/${account.id}/analytics?by=${v.key}&risk=${riskPct}`}
                className={`rounded-full px-3 py-1 font-medium ${
                  view === v.key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {v.label}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          The EA stamps every entry with a tag like{" "}
          <code className="rounded bg-zinc-100 px-1">{sampleTag}</code>, where T
          is the grid tier and S the step inside it. Splitting by tier
          answers the question that matters for an averaging system: do the deep
          legs earn their risk, or do the early ones carry everything?
        </p>
        <AttributionTable
          rows={attribution}
          currency={account.currency}
          emptyLabel="No tagged trades in this history yet."
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Risk units and expectancy</h2>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <p className="text-xs text-zinc-500">Risk unit</p>
          <div className="flex gap-1 text-xs">
            {RISK_BASES.map((b) => (
              <Link
                key={b}
                href={`/dashboard/trading/${account.id}/analytics?by=${view}&risk=${b}`}
                className={`rounded-full px-3 py-1 font-medium ${
                  riskPct === b ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {b}% of balance
              </Link>
            ))}
          </div>
        </div>

        {!r.hasStops && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Not one entry in this history carries a stop loss, so risk per trade
            has no broker defined value. R below is measured against an explicit
            risk unit instead, and the sequence figures divide what each grid
            earned by the worst floating loss it actually sat through. That
            second number is the honest one.
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Avg R per trade"
            value={r.avgR === null ? "n/a" : `${r.avgR >= 0 ? "+" : ""}${num3.format(r.avgR)}R`}
            cls={r.avgR !== null && r.avgR >= 0 ? "text-emerald-700" : "text-red-700"}
            hint={`over ${r.trades} trades`}
          />
          <Tile
            label="Expectancy"
            value={r.expectancyCurrency === null ? "n/a" : signed(r.expectancyCurrency)}
            cls={
              r.expectancyCurrency !== null && r.expectancyCurrency >= 0
                ? "text-emerald-700"
                : "text-red-700"
            }
            hint="per closed trade"
          />
          <Tile
            label="R standard deviation"
            value={r.stdDevR === null ? "n/a" : num3.format(r.stdDevR)}
            hint={
              r.avgR !== null && r.stdDevR !== null && r.stdDevR > 0
                ? `signal to noise ${num2.format(r.avgR / r.stdDevR)}`
                : undefined
            }
          />
          <Tile
            label="Avg MAE R per sequence"
            value={r.avgMaeR === null ? "n/a" : `${r.avgMaeR >= 0 ? "+" : ""}${num3.format(r.avgMaeR)}`}
            cls={r.avgMaeR !== null && r.avgMaeR >= 0 ? "text-emerald-700" : "text-red-700"}
            hint="profit divided by worst floating loss endured"
          />
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Across {r.gridsWithMae} sequences that went underwater, you banked{" "}
          <span className="font-medium text-zinc-900">{signed(r.totalProfit)}</span> while
          sitting through a combined{" "}
          <span className="font-medium text-zinc-900">{money.format(r.totalMae)}</span> of
          floating loss. Worst single sequence ratio:{" "}
          <span className="font-medium text-zinc-900">
            {r.worstMaeR === null ? "n/a" : num3.format(r.worstMaeR)}
          </span>
          .
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Grid sequences by worst excursion</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Overlapping positions grouped into one averaging sequence. The
          excursion is the deepest aggregate floating loss at any price the
          account actually traded at, so it is a floor on the real low, not the
          real low itself. It is shown against the balance riding at that
          moment, not today&apos;s, because a deposit made afterwards would
          otherwise turn a near miss into a rounding error.
        </p>
        {worstGrids.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">No multi leg sequences yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">Legs</th>
                  <th className="pb-2 text-right font-medium">Max lots</th>
                  <th className="pb-2 text-right font-medium">Deepest tier</th>
                  <th className="pb-2 text-right font-medium">Price span</th>
                  <th className="pb-2 text-right font-medium">Worst float</th>
                  <th className="pb-2 text-right font-medium">Of equity then</th>
                  <th className="pb-2 text-right font-medium">Kept</th>
                  <th className="pb-2 text-right font-medium">MAE R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {worstGrids.map((c) => (
                  <tr key={c.id} style={{ fontVariantNumeric: "tabular-nums" }}>
                    <td className="py-2 text-zinc-600">{formatDateTime(c.openedAt)}</td>
                    <td className="py-2 text-right text-zinc-900">{c.maxConcurrent}</td>
                    <td className="py-2 text-right text-zinc-600">{num2.format(c.maxVolume)}</td>
                    <td className="py-2 text-right text-zinc-600">
                      {c.maxTier === null ? "n/a" : `T${c.maxTier}`}
                    </td>
                    <td className="py-2 text-right text-zinc-600">
                      {num2.format(c.priceSpan)}
                    </td>
                    <td className="py-2 text-right font-semibold text-red-700">
                      {money.format(c.mae)}
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${
                        c.maePctOfBalance !== null && c.maePctOfBalance >= 0.2
                          ? "text-red-700"
                          : "text-zinc-600"
                      }`}
                    >
                      {c.maePctOfBalance === null
                        ? "n/a"
                        : `${(c.maePctOfBalance * 100).toFixed(1)}%`}
                    </td>
                    <td className={`py-2 text-right ${pnlClass(c.profit)}`}>
                      {signed(c.profit)}
                    </td>
                    <td className="py-2 text-right text-zinc-600">
                      {num3.format(c.profit / Math.abs(c.mae))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Cost drag</h2>
        <p className="mt-1 text-xs text-zinc-500">
          What the broker took before you saw a number. Small lots held for
          hours are exactly the profile where costs quietly eat the edge.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Gross P/L" value={signed(drag.gross)} cls={pnlClass(drag.gross)} />
          <Tile
            label="Commission and fees"
            value={money.format(drag.commission)}
            cls="text-zinc-900"
          />
          <Tile label="Swap" value={money.format(drag.swap)} cls="text-zinc-900" />
          <Tile label="Net kept" value={signed(drag.net)} cls={pnlClass(drag.net)} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Tile
            label="Costs vs gross winnings"
            value={
              drag.dragOnGrossWins === null ? "n/a" : `${(drag.dragOnGrossWins * 100).toFixed(1)}%`
            }
            hint={`gross winnings ${money.format(drag.grossWins)}`}
          />
          <Tile
            label="Costs vs what you kept"
            value={drag.costsPerNet === null ? "n/a" : `${(drag.costsPerNet * 100).toFixed(0)}%`}
            hint="every 100 kept cost you this much in fees"
          />
          <Tile
            label="Cost per lot"
            value={drag.costPerLot === null ? "n/a" : money.format(drag.costPerLot)}
            hint={`${num2.format(drag.lots)} lots traded`}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Rolling windows</h2>
        <p className="mt-1 text-xs text-zinc-500">
          All time numbers hide decay. If the recent window is materially worse
          than the full history, the system is degrading while the headline
          still looks fine.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="pb-2 font-medium">Window</th>
                <th className="pb-2 text-right font-medium">Trades</th>
                <th className="pb-2 text-right font-medium">Win rate</th>
                <th className="pb-2 text-right font-medium">Net</th>
                <th className="pb-2 text-right font-medium">Avg trade</th>
                <th className="pb-2 text-right font-medium">Profit factor</th>
                <th className="pb-2 text-right font-medium">Costs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {windows.map((w) => (
                <tr key={w.label} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td className="py-2 font-medium text-zinc-900">{w.label}</td>
                  <td className="py-2 text-right text-zinc-600">{w.trades}</td>
                  <td className="py-2 text-right text-zinc-600">
                    {w.winRate === null ? "n/a" : `${Math.round(w.winRate * 100)}%`}
                  </td>
                  <td className={`py-2 text-right font-semibold ${pnlClass(w.net)}`}>
                    {signed(w.net)}
                  </td>
                  <td className={`py-2 text-right ${w.avgTrade === null ? "" : pnlClass(w.avgTrade)}`}>
                    {w.avgTrade === null ? "n/a" : signed(w.avgTrade)}
                  </td>
                  <td className="py-2 text-right text-zinc-600">
                    {w.profitFactor === null ? "n/a" : num2.format(w.profitFactor)}
                  </td>
                  <td className="py-2 text-right text-zinc-500">{money.format(w.costs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">When it works</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Bucketed by the time the first leg opened. Hours and days are West
          Africa Time; sessions are labelled in UTC.
        </p>
        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <TradingDistribution
            title="By session"
            buckets={dist.bySession}
            caption="Where the sequences start"
          />
          <TradingDistribution
            title="By weekday"
            buckets={dist.byWeekday}
            caption="Watch Friday, gold gaps over the weekend"
          />
          <TradingDistribution
            title="By hour (WAT)"
            buckets={dist.byHour}
            caption="Entry hour"
          />
          <TradingDistribution
            title="By symbol"
            buckets={dist.bySymbol}
            caption="Instrument mix"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="font-semibold text-zinc-900">Streaks and worst periods</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Longest losing run"
            value={`${streaks.maxLossStreak} trades`}
            cls="text-red-700"
          />
          <Tile
            label="Longest winning run"
            value={`${streaks.maxWinStreak} trades`}
            cls="text-emerald-700"
          />
          <Tile
            label="Current run"
            value={
              streaks.currentStreak === 0
                ? "none"
                : `${Math.abs(streaks.currentStreak)} ${streaks.currentStreak > 0 ? "wins" : "losses"}`
            }
            cls={streaks.currentStreak >= 0 ? "text-emerald-700" : "text-red-700"}
          />
          <Tile
            label="Winning days"
            value={`${streaks.winningDays} of ${streaks.winningDays + streaks.losingDays}`}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Worst day"
            value={streaks.worstDay ? signed(streaks.worstDay.net) : "n/a"}
            cls="text-red-700"
            hint={streaks.worstDay ? `${streaks.worstDay.label}, ${streaks.worstDay.trades} trades` : undefined}
          />
          <Tile
            label="Best day"
            value={streaks.bestDay ? signed(streaks.bestDay.net) : "n/a"}
            cls="text-emerald-700"
            hint={streaks.bestDay ? `${streaks.bestDay.label}, ${streaks.bestDay.trades} trades` : undefined}
          />
          <Tile
            label="Worst week"
            value={streaks.worstWeek ? signed(streaks.worstWeek.net) : "n/a"}
            cls="text-red-700"
            hint={streaks.worstWeek?.label}
          />
          <Tile
            label="Best week"
            value={streaks.bestWeek ? signed(streaks.bestWeek.net) : "n/a"}
            cls="text-emerald-700"
            hint={streaks.bestWeek?.label}
          />
        </div>
      </section>
    </div>
  );
}
