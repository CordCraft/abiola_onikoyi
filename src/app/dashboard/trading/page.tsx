import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getSnapshots, getTradingAccounts } from "@/lib/trading/data";
import { daysAgo, isStale, marginStatus } from "@/lib/trading/status";
import { formatDateTime } from "@/lib/format";
import TradingLineChart from "@/components/dashboard/TradingLineChart";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default async function TradingPage() {
  await verifySession();
  const accounts = await getTradingAccounts();

  const weekAgo = daysAgo(7);
  const sparklines = await Promise.all(
    accounts.map(async (a) => ({
      id: a.id,
      points: (await getSnapshots(a.id, weekAgo, 150)).map((s) => ({
        t: s.at.getTime(),
        v: s.equity,
      })),
    })),
  );

  const currencies = new Set(accounts.map((a) => a.currency));
  const sameCurrency = currencies.size === 1 ? accounts[0]?.currency : null;
  const totalEquity = accounts.reduce((s, a) => s + a.equity, 0);
  const totalFloating = accounts.reduce((s, a) => s + a.floatingPnl, 0);
  const totalPositions = accounts.reduce((s, a) => s + a.positionCount, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Trading accounts
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Live telemetry from your MT5 terminals, refreshed every 30 seconds
            by the Reporter EA.
          </p>
        </div>
        {accounts.length > 0 && sameCurrency ? (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-zinc-400">
              Combined equity
            </div>
            <div
              className="text-2xl font-bold text-zinc-900"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {money.format(totalEquity)} {sameCurrency}
            </div>
            <div className="text-xs text-zinc-500">
              {totalPositions} open{" "}
              {totalPositions === 1 ? "position" : "positions"},{" "}
              <span className={totalFloating >= 0 ? "text-emerald-700" : "text-red-700"}>
                {totalFloating >= 0 ? "+" : ""}
                {money.format(totalFloating)} floating
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {accounts.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const status = marginStatus(a.marginLevel, a.positionCount);
            const stale = isStale(a.lastSeenAt);
            const spark = sparklines.find((s) => s.id === a.id);
            return (
              <li key={a.id}>
                <Link
                  href={`/dashboard/trading/${a.id}`}
                  className="block rounded-2xl border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-zinc-900">
                        {a.label || a.broker || "Account"}
                      </h2>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        #{a.login} on {a.server}
                      </p>
                    </div>
                    {stale ? (
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
                        Offline
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-50 px-2.5 py-1 text-xs font-medium">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className={status.text}>{status.label}</span>
                      </span>
                    )}
                  </div>

                  <div
                    className="mt-4 text-2xl font-bold text-zinc-900"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {money.format(a.equity)}{" "}
                    <span className="text-sm font-medium text-zinc-400">
                      {a.currency}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>Balance {money.format(a.balance)}</span>
                    <span className="text-zinc-300">·</span>
                    <span className={a.floatingPnl >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {a.floatingPnl >= 0 ? "+" : ""}
                      {money.format(a.floatingPnl)} floating
                    </span>
                  </div>

                  <div className="mt-3 h-12">
                    {spark && spark.points.length > 1 ? (
                      <TradingLineChart
                        compact
                        height={48}
                        series={[
                          { name: "Equity", color: "#2a78d6", points: spark.points },
                        ]}
                      />
                    ) : (
                      <div className="h-full rounded-lg bg-zinc-50" />
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>
                      {a.positionCount} open{" "}
                      {a.positionCount === 1 ? "position" : "positions"}
                      {a.marginLevel !== null
                        ? `, margin ${Math.round(a.marginLevel)}%`
                        : ""}
                    </span>
                    <span>{stale ? `Last seen ${formatDateTime(a.lastSeenAt)}` : "Live"}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <details
        className="mt-10 rounded-2xl border border-zinc-200 bg-white p-6"
        open={accounts.length === 0}
      >
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
          {accounts.length === 0
            ? "Connect your first terminal"
            : "Connect another terminal"}
        </summary>
        <div className="mt-4 space-y-3 text-sm text-zinc-600">
          <p>
            Each MT5 terminal reports itself with a tiny read-only Expert
            Advisor. It never places or modifies trades; it only posts balance,
            equity, margin, open positions and closed deals here.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Make sure <code className="rounded bg-zinc-100 px-1">TRADING_INGEST_SECRET</code>{" "}
              is set in the Netlify environment (and redeploy once after adding it).
            </li>
            <li>
              On the VPS, download{" "}
              <a
                href="/trading/OnikoyiReporter.mq5"
                className="font-medium text-zinc-900 underline"
                download
              >
                OnikoyiReporter.mq5
              </a>{" "}
              and place it in the terminal&apos;s{" "}
              <code className="rounded bg-zinc-100 px-1">MQL5\Experts</code> folder
              (File, Open Data Folder), then compile it in MetaEditor (F7).
            </li>
            <li>
              In the terminal go to Tools, Options, Expert Advisors and tick
              &quot;Allow WebRequest for listed URL&quot;, adding{" "}
              <code className="rounded bg-zinc-100 px-1">https://abiolaonikoyi.com</code>.
            </li>
            <li>
              Attach the EA to any single chart. Set{" "}
              <code className="rounded bg-zinc-100 px-1">InpSecret</code> to the same
              shared secret and{" "}
              <code className="rounded bg-zinc-100 px-1">InpLabel</code> to the broker
              name (Vantage, BlackBull or Exness). Keep Algo Trading enabled; the
              EA needs it for its timer, not for trading.
            </li>
            <li>
              The account appears here within a minute. Older history backfills
              automatically at 200 deals per post, roughly 24,000 deals per hour.
            </li>
          </ol>
        </div>
      </details>
    </div>
  );
}
