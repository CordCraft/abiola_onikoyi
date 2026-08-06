import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureTradingTables } from "./setup";

// Shape of one open position inside TradingAccount.openPositions /
// TradingSnapshot.positions (written by the ingest route from EA payloads).
export type LivePosition = {
  ticket: string;
  symbol: string;
  type: "buy" | "sell";
  volume: number;
  openPrice: number;
  openTime: string; // ISO, UTC
  sl: number | null;
  tp: number | null;
  currentPrice: number;
  profit: number;
  swap: number;
};

export type DealRow = {
  id: string;
  ticket: string;
  orderTicket: string | null;
  positionId: string | null;
  symbol: string;
  type: string;
  entry: string;
  volume: number;
  price: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  swap: number;
  commission: number;
  fee: number;
  magic: string | null;
  comment: string | null;
  time: Date;
};

// A round-trip trade: all deals sharing an MT5 positionId, netted together.
export type Trade = {
  positionId: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number; // total entered volume (lots)
  openTime: Date;
  closeTime: Date | null; // null while still open
  openPrice: number; // volume-weighted entry
  closePrice: number | null; // volume-weighted exit
  sl: number | null;
  tp: number | null;
  profit: number; // net: trade P/L + swap + commission + fee
  swap: number;
  commission: number;
  magic: string | null;
  comment: string | null;
  durationSeconds: number | null;
};

export type TradeStats = {
  closedCount: number;
  wins: number;
  losses: number;
  winRate: number | null; // 0..1
  netProfit: number;
  grossProfit: number;
  grossLoss: number; // negative
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null; // negative
  bestTrade: number | null;
  worstTrade: number | null;
  avgDurationSeconds: number | null;
  maxConcurrent: number;
  // Peak-to-trough drop of the closed-balance curve, in account currency
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  deposits: number;
  withdrawals: number;
};

export async function getTradingAccounts() {
  await ensureTradingTables();
  return prisma.tradingAccount.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getTradingAccount(id: string) {
  await ensureTradingTables();
  return prisma.tradingAccount.findUnique({ where: { id } });
}

export async function getDeals(accountId: string): Promise<DealRow[]> {
  return prisma.tradingDeal.findMany({
    where: { accountId },
    orderBy: { time: "asc" },
  });
}

// Snapshots for charts, downsampled to at most `maxPoints` evenly spaced rows
// so a month of 30-second data does not flood the page payload.
export async function getSnapshots(
  accountId: string,
  since: Date,
  maxPoints = 1500,
) {
  const rows = await prisma.tradingSnapshot.findMany({
    where: { accountId, at: { gte: since } },
    orderBy: { at: "asc" },
    select: {
      at: true,
      balance: true,
      equity: true,
      marginLevel: true,
      floatingPnl: true,
      positionCount: true,
    },
  });
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints;
  const out: typeof rows = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(rows[Math.floor(i * step)]);
  }
  // Always keep the freshest point
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

// Groups raw MT5 deals into round-trip trades. Balance operations (deposits,
// withdrawals, credits) have no positionId and are excluded here; they are
// surfaced separately via stats.
export function groupTrades(deals: DealRow[]): Trade[] {
  const byPosition = new Map<string, DealRow[]>();
  for (const d of deals) {
    if (d.type !== "buy" && d.type !== "sell") continue;
    if (!d.positionId || d.positionId === "0") continue;
    const list = byPosition.get(d.positionId) ?? [];
    list.push(d);
    byPosition.set(d.positionId, list);
  }

  const trades: Trade[] = [];
  for (const [positionId, list] of byPosition) {
    list.sort((a, b) => a.time.getTime() - b.time.getTime());
    const entries = list.filter((d) => d.entry === "in" || d.entry === "inout");
    const exits = list.filter(
      (d) => d.entry === "out" || d.entry === "out_by" || d.entry === "inout",
    );
    const first = list[0];
    const entryVolume = entries.reduce((s, d) => s + d.volume, 0);
    const exitVolume = exits.reduce((s, d) => s + d.volume, 0);
    const vwap = (rows: DealRow[]) => {
      const vol = rows.reduce((s, d) => s + d.volume, 0);
      if (vol === 0) return rows[0]?.price ?? 0;
      return rows.reduce((s, d) => s + d.price * d.volume, 0) / vol;
    };
    // Open when less volume has exited than entered (partial close tolerance)
    const closed = exitVolume >= entryVolume - 1e-9 && exits.length > 0;
    const lastExit = exits[exits.length - 1];
    const profit = list.reduce(
      (s, d) => s + d.profit + d.swap + d.commission + d.fee,
      0,
    );
    trades.push({
      positionId,
      symbol: first.symbol,
      direction: (entries[0] ?? first).type as "buy" | "sell",
      volume: entryVolume,
      openTime: first.time,
      closeTime: closed ? lastExit.time : null,
      openPrice: vwap(entries.length ? entries : [first]),
      closePrice: closed ? vwap(exits) : null,
      sl: lastExit?.sl ?? first.sl ?? null,
      tp: lastExit?.tp ?? first.tp ?? null,
      profit,
      swap: list.reduce((s, d) => s + d.swap, 0),
      commission: list.reduce((s, d) => s + d.commission + d.fee, 0),
      magic: first.magic,
      comment: first.comment,
      durationSeconds: closed
        ? Math.round((lastExit.time.getTime() - first.time.getTime()) / 1000)
        : null,
    });
  }
  trades.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  return trades;
}

export function computeStats(trades: Trade[], deals: DealRow[]): TradeStats {
  const closed = trades.filter((t) => t.closeTime !== null);
  const wins = closed.filter((t) => t.profit > 0);
  const losses = closed.filter((t) => t.profit <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = losses.reduce((s, t) => s + t.profit, 0);

  // Deposits and withdrawals are "balance" deals (positive = deposit).
  const balanceOps = deals.filter(
    (d) => d.type === "balance" || d.type === "credit",
  );
  const deposits = balanceOps
    .filter((d) => d.profit > 0)
    .reduce((s, d) => s + d.profit, 0);
  const withdrawals = balanceOps
    .filter((d) => d.profit < 0)
    .reduce((s, d) => s + d.profit, 0);

  // Max concurrent open trades: sweep over open/close events.
  const events: Array<{ t: number; delta: number }> = [];
  for (const t of trades) {
    events.push({ t: t.openTime.getTime(), delta: 1 });
    events.push({
      t: t.closeTime ? t.closeTime.getTime() : Number.MAX_SAFE_INTEGER,
      delta: -1,
    });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let open = 0;
  let maxConcurrent = 0;
  for (const e of events) {
    open += e.delta;
    if (open > maxConcurrent) maxConcurrent = open;
  }

  // Closed-balance curve: balance ops + closed trades in time order.
  type Point = { t: number; delta: number };
  const curve: Point[] = [
    ...balanceOps.map((d) => ({ t: d.time.getTime(), delta: d.profit })),
    ...closed.map((t) => ({ t: t.closeTime!.getTime(), delta: t.profit })),
  ].sort((a, b) => a.t - b.t);
  let bal = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct: number | null = null;
  for (const p of curve) {
    bal += p.delta;
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? dd / peak : null;
    }
  }

  const durations = closed
    .map((t) => t.durationSeconds)
    .filter((d): d is number => d !== null);

  return {
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    netProfit: grossProfit + grossLoss,
    grossProfit,
    grossLoss,
    profitFactor:
      grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : wins.length ? Infinity : null,
    avgWin: wins.length ? grossProfit / wins.length : null,
    avgLoss: losses.length ? grossLoss / losses.length : null,
    bestTrade: closed.length ? Math.max(...closed.map((t) => t.profit)) : null,
    worstTrade: closed.length ? Math.min(...closed.map((t) => t.profit)) : null,
    avgDurationSeconds: durations.length
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : null,
    maxConcurrent,
    maxDrawdown,
    maxDrawdownPct,
    deposits,
    withdrawals,
  };
}
