import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureTradingTables } from "@/lib/trading/setup";
import { checkSnapshotAlerts } from "@/lib/trading/alerts";
import type { LivePosition } from "@/lib/trading/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receives read-only account telemetry from the OnikoyiReporter MT5 EA
// (public/trading/OnikoyiReporter.mq5). Lives under /api/* on purpose: the
// proxy matcher does not cover it, and auth is the shared-secret header the
// EA sends (same machine-to-machine pattern as the cron routes).
//
// Payload (all times are epoch seconds in BROKER SERVER time unless noted):
// {
//   account: { login, server, broker, label?, name?, currency, leverage },
//   time: { server, gmt },            // for computing the broker GMT offset
//   snapshot: { balance, equity, margin, freeMargin, marginLevel, profit,
//               positions: [{ ticket, symbol, type, volume, openPrice,
//                             openTime, sl, tp, currentPrice, profit, swap }] },
//   deals: [{ ticket, order, position, symbol, type, entry, volume, price,
//             sl, tp, profit, swap, commission, fee, magic, comment, time }],
// }
// Response: { ok: true, sinceTicket: "<highest stored deal ticket>" } so the
// EA knows where history sync stands; deal writes are idempotent upserts, so
// re-sending is always safe.

type IngestPosition = {
  ticket: number | string;
  symbol: string;
  type: string;
  volume: number;
  openPrice: number;
  openTime: number;
  sl?: number;
  tp?: number;
  currentPrice: number;
  profit: number;
  swap: number;
};

type IngestDeal = {
  ticket: number | string;
  order?: number | string;
  position?: number | string;
  symbol?: string;
  type: string;
  entry?: string;
  volume?: number;
  price?: number;
  sl?: number;
  tp?: number;
  profit?: number;
  swap?: number;
  commission?: number;
  fee?: number;
  magic?: number | string;
  comment?: string;
  time: number;
};

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const FLAT_SNAPSHOT_INTERVAL_MS = 15 * 60_000;
const SNAPSHOT_RETENTION_DAYS = 120;

const toBigInt = (v: unknown): bigint => {
  try {
    return v === null || v === undefined ? BigInt(0) : BigInt(String(v).split(".")[0]);
  } catch {
    return BigInt(0);
  }
};

// Highest stored deal ticket for an account, as one value computed in the
// database (CAST ... AS NUMERIC works on Postgres and on the SQLite test db).
// Falls back to the old scan of the newest 500 tickets if the cast ever fails,
// for example on a malformed ticket.
async function highestTicket(accountId: string): Promise<bigint> {
  try {
    const rows = await prisma.$queryRaw<{ max: string | null }[]>`
      SELECT CAST(MAX(CAST("ticket" AS NUMERIC)) AS TEXT) AS "max"
      FROM "TradingDeal" WHERE "accountId" = ${accountId}`;
    return toBigInt(rows[0]?.max);
  } catch (err) {
    console.error("trading ingest: max ticket query failed, scanning instead", err);
    const tickets = await prisma.tradingDeal.findMany({
      where: { accountId },
      select: { ticket: true },
      orderBy: { time: "desc" },
      take: 500,
    });
    let best = BigInt(0);
    for (const t of tickets) {
      const v = toBigInt(t.ticket);
      if (v > best) best = v;
    }
    return best;
  }
}

export async function POST(req: Request) {
  const secret = process.env.TRADING_INGEST_SECRET;
  if (!secret || req.headers.get("x-trading-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    account?: Record<string, unknown>;
    time?: { server?: number; gmt?: number };
    snapshot?: Record<string, unknown> & { positions?: IngestPosition[] };
    deals?: IngestDeal[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const acc = body.account;
  if (!acc || !acc.login || !acc.server) {
    return NextResponse.json(
      { ok: false, error: "Missing account.login or account.server" },
      { status: 400 },
    );
  }

  await ensureTradingTables();

  // Broker clocks run ahead of or behind GMT; deals arrive in server time.
  // Round to the nearest half hour to shrug off network latency.
  const rawOffset = num(body.time?.server) - num(body.time?.gmt);
  const gmtOffsetSeconds = Math.round(rawOffset / 1800) * 1800;
  const toUtc = (serverEpochSeconds: number): Date =>
    new Date((serverEpochSeconds - gmtOffsetSeconds) * 1000);

  const login = String(acc.login);
  const server = String(acc.server);
  const accountKey = `${login}@${server}`;

  const snap = body.snapshot ?? {};
  const rawPositions = Array.isArray(snap.positions) ? snap.positions : [];
  const positions = rawPositions.map((p) => ({
    ticket: String(p.ticket),
    symbol: String(p.symbol ?? ""),
    type: p.type === "sell" ? "sell" : "buy",
    volume: num(p.volume),
    openPrice: num(p.openPrice),
    openTime: toUtc(num(p.openTime)).toISOString(),
    sl: p.sl ? num(p.sl) : null,
    tp: p.tp ? num(p.tp) : null,
    currentPrice: num(p.currentPrice),
    profit: num(p.profit),
    swap: num(p.swap),
  }));

  const margin = num(snap.margin);
  const equity = num(snap.equity);
  const live = {
    login,
    server,
    broker: String(acc.broker ?? ""),
    label: acc.label ? String(acc.label) : null,
    name: acc.name ? String(acc.name) : null,
    currency: String(acc.currency ?? "USD"),
    leverage: acc.leverage ? num(acc.leverage) : null,
    balance: num(snap.balance),
    equity,
    margin,
    freeMargin: num(snap.freeMargin),
    marginLevel: margin > 0 ? (equity / margin) * 100 : null,
    floatingPnl: num(snap.profit),
    positionCount: positions.length,
    openPositions: positions,
    gmtOffsetSeconds,
    lastSeenAt: new Date(),
  };

  // Return only what the alerts need: this runs every 30s per account, and the
  // full row (with openPositions JSON) was a steady share of Supabase egress.
  const account = await prisma.tradingAccount.upsert({
    where: { accountKey },
    create: { accountKey, ...live },
    update: live,
    select: { id: true, broker: true, label: true, alertState: true },
  });

  // Drawdown and margin alerts against the fresh numbers (never throws).
  await checkSnapshotAlerts(account, {
    balance: live.balance,
    equity: live.equity,
    margin: live.margin,
    marginLevel: live.marginLevel,
    positions: positions as LivePosition[],
  });

  // Snapshot cadence: every post while positions are open (the interesting
  // window for drawdown and stop-out analysis), every ~15 minutes while flat.
  let snapshotStored = false;
  if (positions.length > 0) {
    snapshotStored = true;
  } else {
    const latest = await prisma.tradingSnapshot.findFirst({
      where: { accountId: account.id },
      orderBy: { at: "desc" },
      select: { at: true },
    });
    snapshotStored =
      !latest || Date.now() - latest.at.getTime() > FLAT_SNAPSHOT_INTERVAL_MS;
    if (snapshotStored) {
      // Opportunistic retention pruning on the slow path.
      await prisma.tradingSnapshot
        .deleteMany({
          where: {
            accountId: account.id,
            at: { lt: new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000) },
          },
        })
        .catch(() => {});
    }
  }
  if (snapshotStored) {
    await prisma.tradingSnapshot.create({
      data: {
        accountId: account.id,
        balance: live.balance,
        equity: live.equity,
        margin: live.margin,
        freeMargin: live.freeMargin,
        marginLevel: live.marginLevel,
        floatingPnl: live.floatingPnl,
        positionCount: live.positionCount,
        positions: positions.length > 0 ? positions : undefined,
      },
    });
  }

  // Deal history sync: idempotent per (accountId, ticket).
  const deals = Array.isArray(body.deals) ? body.deals : [];
  let dealsStored = 0;
  if (deals.length > 0) {
    const rows = deals
      .filter((d) => d && d.ticket !== undefined && d.time !== undefined)
      .map((d) => ({
        accountId: account.id,
        ticket: String(d.ticket),
        orderTicket: d.order !== undefined ? String(d.order) : null,
        positionId: d.position !== undefined ? String(d.position) : null,
        symbol: String(d.symbol ?? ""),
        type: String(d.type ?? "other"),
        entry: String(d.entry ?? ""),
        volume: num(d.volume),
        price: num(d.price),
        sl: d.sl ? num(d.sl) : null,
        tp: d.tp ? num(d.tp) : null,
        profit: num(d.profit),
        swap: num(d.swap),
        commission: num(d.commission),
        fee: num(d.fee),
        magic: d.magic !== undefined && d.magic !== 0 ? String(d.magic) : null,
        comment: d.comment ? String(d.comment).slice(0, 200) : null,
        time: toUtc(num(d.time)),
      }));
    // Provider-agnostic dedup (skipDuplicates only exists on Postgres):
    // filter out tickets we already hold, then insert the rest in one batch.
    const existing = new Set(
      (
        await prisma.tradingDeal.findMany({
          where: { accountId: account.id, ticket: { in: rows.map((r) => r.ticket) } },
          select: { ticket: true },
        })
      ).map((r) => r.ticket),
    );
    const fresh = rows.filter((r) => !existing.has(r.ticket));
    if (fresh.length > 0) {
      try {
        const res = await prisma.tradingDeal.createMany({ data: fresh });
        dealsStored = res.count;
      } catch {
        // A concurrent post slipped a duplicate in between: upsert row by row.
        for (const row of fresh) {
          await prisma.tradingDeal.upsert({
            where: {
              accountId_ticket: { accountId: row.accountId, ticket: row.ticket },
            },
            create: row,
            update: {},
          });
          dealsStored++;
        }
      }
    }
  }

  // Highest stored ticket, compared numerically (tickets are ulongs stored as
  // text, so ORDER BY on the column would be a lexicographic trap). The database
  // computes the max and sends back one value: pulling the last 500 tickets on
  // every post was ~90% of the project's Supabase egress (Nov 2026).
  const sinceTicket = await highestTicket(account.id);

  return NextResponse.json({
    ok: true,
    sinceTicket: sinceTicket.toString(),
    dealsStored,
    snapshotStored,
  });
}
