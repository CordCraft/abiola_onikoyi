import type { DealRow, LivePosition, Trade } from "./data";

// Derived analytics over grouped trades. Everything here is pure so it can be
// unit tested and reused by both the account page and the overview page.
//
// Two things shape the design:
//
// 1. The EA writes a tag into every entry comment, "QQ[XAUUSD+]1234[T2/S03]".
//    T is the grid tier and S the step inside it, so attribution by tag is
//    really attribution by grid depth: it answers whether the deep averaging
//    legs pay for themselves or quietly bleed.
// 2. Not one entry in the history carries a stop loss, so classical R
//    (risk = distance to stop) is undefined. R here is measured against an
//    explicit risk unit instead, and grids also get an MAE based R that
//    divides what a sequence earned by the worst floating loss it sat
//    through. Both are labelled at the call site so the basis is never
//    ambiguous.

// ---------------------------------------------------------------------------
// Algo tags
// ---------------------------------------------------------------------------

export type AlgoTag = {
  raw: string | null;
  prefix: string | null;
  symbol: string | null;
  magic: string | null;
  tier: number | null;
  step: number | null;
};

const TAG_RE = /^([A-Za-z]+)\[([^\]]+)\](\d+)\[T(\d+)\/S(\d+)\]$/;

export function parseAlgoTag(comment: string | null): AlgoTag {
  const raw = comment?.trim() || null;
  if (!raw) return { raw, prefix: null, symbol: null, magic: null, tier: null, step: null };
  const m = TAG_RE.exec(raw);
  if (!m) return { raw, prefix: null, symbol: null, magic: null, tier: null, step: null };
  return {
    raw,
    prefix: m[1],
    symbol: m[2],
    magic: m[3],
    tier: Number(m[4]),
    step: Number(m[5]),
  };
}

// ---------------------------------------------------------------------------
// Point value (account currency per 1.00 of price movement, per lot)
//
// Inferred from the trades themselves rather than hardcoded per symbol: the
// broker's own numbers are the ground truth, and the three brokers spell gold
// three different ways (XAUUSD, XAUUSD+, XAUUSDp).
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function grossOf(t: Trade): number {
  // Trade.profit is net; Trade.commission already folds in fee.
  return t.profit - t.swap - t.commission;
}

export function inferPointValues(trades: Trade[]): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const t of trades) {
    if (t.closePrice === null || t.volume <= 0) continue;
    const diff = t.direction === "buy" ? t.closePrice - t.openPrice : t.openPrice - t.closePrice;
    if (Math.abs(diff) < 1e-6) continue;
    const pv = grossOf(t) / (diff * t.volume);
    if (!Number.isFinite(pv) || pv <= 0) continue;
    const list = samples.get(t.symbol) ?? [];
    list.push(pv);
    samples.set(t.symbol, list);
  }
  const out = new Map<string, number>();
  for (const [symbol, list] of samples) {
    const m = median(list);
    if (m !== null) out.set(symbol, m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Balance timeline
//
// Balance is the running sum of every deal effect, so it reconstructs exactly
// without needing a starting figure. Used as the denominator for R and as the
// base for the deposit adjusted return curve.
// ---------------------------------------------------------------------------

export type BalancePoint = { t: number; balance: number };

export function buildBalanceTimeline(deals: DealRow[]): BalancePoint[] {
  const sorted = [...deals].sort((a, b) => a.time.getTime() - b.time.getTime());
  const out: BalancePoint[] = [];
  let balance = 0;
  for (const d of sorted) {
    balance += d.profit + d.swap + d.commission + d.fee;
    out.push({ t: d.time.getTime(), balance });
  }
  return out;
}

// Balance immediately before time `t`. Binary search over the timeline.
export function balanceBefore(timeline: BalancePoint[], t: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t < t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx >= 0 ? timeline[idx].balance : 0;
}

// ---------------------------------------------------------------------------
// Grid clusters
//
// A cluster is a set of trades whose open/close intervals overlap
// transitively: one averaging sequence. Its MAE is the worst aggregate
// floating loss observed at any price the account actually traded at, which
// makes it a lower bound on the real excursion (the true low between two
// fills is invisible without tick data).
// ---------------------------------------------------------------------------

export type GridCluster = {
  id: string;
  symbol: string;
  legs: Trade[];
  openedAt: Date;
  closedAt: Date | null;
  maxConcurrent: number;
  maxVolume: number;
  maxTier: number | null;
  maxStep: number | null;
  priceSpan: number;
  profit: number;
  costs: number;
  // Worst observed aggregate floating loss, negative, in account currency
  mae: number;
  maeAt: Date | null;
  maePrice: number | null;
  maeLegs: number;
  maeVolume: number;
  // Balance riding at the moment of the worst excursion, and the excursion as
  // a share of it. Measuring against today's balance is how a deposit made
  // after the fact quietly launders a near miss into a rounding error.
  maeBalance: number | null;
  maePctOfBalance: number | null;
};

export function buildClusters(
  trades: Trade[],
  pointValues: Map<string, number>,
  timeline?: BalancePoint[],
): GridCluster[] {
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }

  const clusters: GridCluster[] = [];
  for (const [symbol, list] of bySymbol) {
    const pv = pointValues.get(symbol) ?? null;
    const sorted = [...list].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
    let current: Trade[] = [];
    let until = -Infinity;

    const flush = () => {
      if (current.length === 0) return;
      clusters.push(makeCluster(symbol, current, pv, timeline));
      current = [];
    };

    for (const t of sorted) {
      const closeMs = t.closeTime ? t.closeTime.getTime() : Number.MAX_SAFE_INTEGER;
      if (current.length > 0 && t.openTime.getTime() <= until) {
        current.push(t);
        until = Math.max(until, closeMs);
      } else {
        flush();
        current = [t];
        until = closeMs;
      }
    }
    flush();
  }

  clusters.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  return clusters;
}

function makeCluster(
  symbol: string,
  legs: Trade[],
  pointValue: number | null,
  timeline?: BalancePoint[],
): GridCluster {
  // Candidate worst moments: every price the cluster actually printed.
  const marks: Array<{ t: number; price: number }> = [];
  for (const l of legs) {
    marks.push({ t: l.openTime.getTime(), price: l.openPrice });
    if (l.closeTime && l.closePrice !== null) {
      marks.push({ t: l.closeTime.getTime(), price: l.closePrice });
    }
  }
  marks.sort((a, b) => a.t - b.t);

  let mae = 0;
  let maeAt: number | null = null;
  let maePrice: number | null = null;
  let maeLegs = 0;
  let maeVolume = 0;
  let maxConcurrent = 0;
  let maxVolume = 0;

  for (const mark of marks) {
    const open = legs.filter(
      (l) =>
        l.openTime.getTime() <= mark.t &&
        (l.closeTime === null || l.closeTime.getTime() > mark.t),
    );
    if (open.length === 0) continue;
    const volume = open.reduce((s, l) => s + l.volume, 0);
    if (open.length > maxConcurrent) maxConcurrent = open.length;
    if (volume > maxVolume) maxVolume = volume;
    if (pointValue === null) continue;
    const floating = open.reduce((s, l) => {
      const diff = l.direction === "buy" ? mark.price - l.openPrice : l.openPrice - mark.price;
      return s + diff * l.volume * pointValue;
    }, 0);
    if (floating < mae) {
      mae = floating;
      maeAt = mark.t;
      maePrice = mark.price;
      maeLegs = open.length;
      maeVolume = volume;
    }
  }

  const maeBalance =
    timeline && maeAt !== null ? balanceBefore(timeline, maeAt) : null;

  const tags = legs.map((l) => parseAlgoTag(l.comment));
  const tiers = tags.map((t) => t.tier).filter((v): v is number => v !== null);
  const steps = tags.map((t) => t.step).filter((v): v is number => v !== null);
  const prices = legs.map((l) => l.openPrice);
  const closes = legs.map((l) => l.closeTime?.getTime() ?? null);
  const allClosed = closes.every((c) => c !== null);

  return {
    id: legs[0].positionId,
    symbol,
    legs,
    openedAt: legs[0].openTime,
    closedAt: allClosed
      ? new Date(Math.max(...(closes as number[])))
      : null,
    maxConcurrent,
    maxVolume,
    maxTier: tiers.length ? Math.max(...tiers) : null,
    maxStep: steps.length ? Math.max(...steps) : null,
    priceSpan: Math.max(...prices) - Math.min(...prices),
    profit: legs.reduce((s, l) => s + l.profit, 0),
    costs: legs.reduce((s, l) => s + l.swap + l.commission, 0),
    mae,
    maeAt: maeAt === null ? null : new Date(maeAt),
    maePrice,
    maeLegs,
    maeVolume,
    maeBalance,
    maePctOfBalance:
      maeBalance !== null && maeBalance > 0 ? Math.abs(mae) / maeBalance : null,
  };
}

// ---------------------------------------------------------------------------
// R multiples and expectancy
// ---------------------------------------------------------------------------

export type RSummary = {
  basisPct: number; // risk unit as a percent of balance at entry
  hasStops: boolean; // whether any entry in the history carried a stop loss
  trades: number;
  avgR: number | null;
  expectancyCurrency: number | null;
  bestR: number | null;
  worstR: number | null;
  stdDevR: number | null;
  // Grid level: profit divided by the worst floating loss actually endured
  grids: number;
  gridsWithMae: number;
  avgMaeR: number | null;
  worstMaeR: number | null;
  totalProfit: number;
  totalMae: number;
};

export function summariseR(
  trades: Trade[],
  clusters: GridCluster[],
  deals: DealRow[],
  basisPct: number,
): RSummary {
  const timeline = buildBalanceTimeline(deals);
  const closed = trades.filter((t) => t.closeTime !== null);
  const hasStops = deals.some((d) => d.sl !== null && d.sl > 0);

  const rs: number[] = [];
  for (const t of closed) {
    const base = balanceBefore(timeline, t.openTime.getTime());
    const unit = (base * basisPct) / 100;
    if (unit <= 0) continue;
    rs.push(t.profit / unit);
  }
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;
  const stdDevR =
    rs.length > 1 && avgR !== null
      ? Math.sqrt(rs.reduce((s, r) => s + (r - avgR) ** 2, 0) / (rs.length - 1))
      : null;

  const closedClusters = clusters.filter((c) => c.closedAt !== null);
  const withMae = closedClusters.filter((c) => c.mae < 0);
  const maeRs = withMae.map((c) => c.profit / Math.abs(c.mae));

  return {
    basisPct,
    hasStops,
    trades: rs.length,
    avgR,
    expectancyCurrency: closed.length
      ? closed.reduce((s, t) => s + t.profit, 0) / closed.length
      : null,
    bestR: rs.length ? Math.max(...rs) : null,
    worstR: rs.length ? Math.min(...rs) : null,
    stdDevR,
    grids: closedClusters.length,
    gridsWithMae: withMae.length,
    avgMaeR: maeRs.length ? maeRs.reduce((s, r) => s + r, 0) / maeRs.length : null,
    worstMaeR: maeRs.length ? Math.min(...maeRs) : null,
    totalProfit: closedClusters.reduce((s, c) => s + c.profit, 0),
    totalMae: withMae.reduce((s, c) => s + c.mae, 0),
  };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export type AttributionRow = {
  key: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number | null;
  gross: number;
  costs: number;
  net: number;
  profitFactor: number | null;
  avgTrade: number;
  volume: number;
  share: number; // share of total net, signed
};

function attribute(
  trades: Trade[],
  keyOf: (t: Trade) => string | null,
  labelOf: (key: string) => string,
): AttributionRow[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = keyOf(t);
    if (key === null) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const totalNet = trades.reduce((s, t) => s + t.profit, 0);
  const rows: AttributionRow[] = [];
  for (const [key, list] of groups) {
    const wins = list.filter((t) => t.profit > 0);
    const grossWin = list.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0);
    const grossLoss = list.filter((t) => t.profit <= 0).reduce((s, t) => s + t.profit, 0);
    const net = list.reduce((s, t) => s + t.profit, 0);
    rows.push({
      key,
      label: labelOf(key),
      trades: list.length,
      wins: wins.length,
      winRate: list.length ? wins.length / list.length : null,
      gross: list.reduce((s, t) => s + grossOf(t), 0),
      costs: list.reduce((s, t) => s + t.swap + t.commission, 0),
      net,
      profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null,
      avgTrade: list.length ? net / list.length : 0,
      volume: list.reduce((s, t) => s + t.volume, 0),
      share: totalNet !== 0 ? net / Math.abs(totalNet) : 0,
    });
  }
  return rows;
}

export function attributionByTier(trades: Trade[]): AttributionRow[] {
  return attribute(
    trades,
    (t) => {
      const tag = parseAlgoTag(t.comment);
      return tag.tier === null ? null : String(tag.tier);
    },
    (key) => `Tier ${key}`,
  ).sort((a, b) => Number(a.key) - Number(b.key));
}

export function attributionByStep(trades: Trade[]): AttributionRow[] {
  return attribute(
    trades,
    (t) => {
      const tag = parseAlgoTag(t.comment);
      return tag.step === null ? null : String(tag.step);
    },
    (key) => `Step ${key.padStart(2, "0")}`,
  ).sort((a, b) => Number(a.key) - Number(b.key));
}

export function attributionByTag(trades: Trade[]): AttributionRow[] {
  return attribute(
    trades,
    (t) => {
      const tag = parseAlgoTag(t.comment);
      if (tag.tier === null || tag.step === null) return t.comment ?? "untagged";
      return `T${tag.tier}/S${String(tag.step).padStart(2, "0")}`;
    },
    (key) => key,
  ).sort((a, b) => b.trades - a.trades);
}

export function attributionBySymbol(trades: Trade[]): AttributionRow[] {
  return attribute(trades, (t) => t.symbol, (key) => key).sort((a, b) => b.trades - a.trades);
}

export function attributionByMagic(trades: Trade[]): AttributionRow[] {
  return attribute(
    trades,
    (t) => parseAlgoTag(t.comment).magic ?? t.magic ?? "none",
    (key) => (key === "none" ? "No magic number" : `Magic ${key}`),
  ).sort((a, b) => b.trades - a.trades);
}

// ---------------------------------------------------------------------------
// Cost drag
// ---------------------------------------------------------------------------

export type CostDrag = {
  gross: number;
  grossWins: number;
  grossLosses: number;
  swap: number;
  commission: number; // includes fee, as grouped in data.ts
  totalCosts: number;
  net: number;
  // Costs as a share of gross winnings: what the brokers took off the top
  dragOnGrossWins: number | null;
  // Costs as a share of what you actually kept
  costsPerNet: number | null;
  avgCostPerTrade: number | null;
  costPerLot: number | null;
  trades: number;
  lots: number;
};

export function computeCostDrag(trades: Trade[]): CostDrag {
  const closed = trades.filter((t) => t.closeTime !== null);
  const gross = closed.reduce((s, t) => s + grossOf(t), 0);
  const grossWins = closed.filter((t) => grossOf(t) > 0).reduce((s, t) => s + grossOf(t), 0);
  const grossLosses = closed.filter((t) => grossOf(t) <= 0).reduce((s, t) => s + grossOf(t), 0);
  const swap = closed.reduce((s, t) => s + t.swap, 0);
  const commission = closed.reduce((s, t) => s + t.commission, 0);
  const totalCosts = swap + commission;
  const net = closed.reduce((s, t) => s + t.profit, 0);
  const lots = closed.reduce((s, t) => s + t.volume, 0);
  return {
    gross,
    grossWins,
    grossLosses,
    swap,
    commission,
    totalCosts,
    net,
    dragOnGrossWins: grossWins > 0 ? Math.abs(totalCosts) / grossWins : null,
    costsPerNet: net > 0 ? Math.abs(totalCosts) / net : null,
    avgCostPerTrade: closed.length ? totalCosts / closed.length : null,
    costPerLot: lots > 0 ? totalCosts / lots : null,
    trades: closed.length,
    lots,
  };
}

// ---------------------------------------------------------------------------
// Deposit adjusted return curve and underwater plot
//
// Time weighted: every closed trade contributes profit / balance-before, so
// deposits and withdrawals move the balance without ever moving the return
// index. This is what makes the drawdown percentage honest; measuring a drop
// against a raw running balance that includes deposit timing does not.
// ---------------------------------------------------------------------------

export type ReturnCurve = {
  points: Array<{ t: number; index: number; returnPct: number; underwaterPct: number; balance: number }>;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownAt: Date | null;
  currentDrawdownPct: number | null;
  longestUnderwaterDays: number | null;
  deposits: number;
  withdrawals: number;
};

export function buildReturnCurve(trades: Trade[], deals: DealRow[]): ReturnCurve {
  const balanceOps = deals.filter((d) => d.type === "balance" || d.type === "credit");
  const closed = trades.filter((t) => t.closeTime !== null);

  type Event = { t: number; kind: "deposit" | "trade"; amount: number };
  const events: Event[] = [
    ...balanceOps.map((d) => ({
      t: d.time.getTime(),
      kind: "deposit" as const,
      amount: d.profit + d.swap + d.commission + d.fee,
    })),
    ...closed.map((t) => ({ t: t.closeTime!.getTime(), kind: "trade" as const, amount: t.profit })),
  ].sort((a, b) => a.t - b.t || (a.kind === "deposit" ? -1 : 1));

  let balance = 0;
  let index = 1;
  let peak = 1;
  let maxDd = 0;
  let maxDdAt: number | null = null;
  let underwaterSince: number | null = null;
  let longestUnderwater = 0;

  const points: ReturnCurve["points"] = [];
  for (const e of events) {
    if (e.kind === "deposit") {
      balance += e.amount;
    } else {
      if (balance > 0) index *= 1 + e.amount / balance;
      balance += e.amount;
    }
    if (index > peak) {
      peak = index;
      if (underwaterSince !== null) {
        longestUnderwater = Math.max(longestUnderwater, e.t - underwaterSince);
        underwaterSince = null;
      }
    } else if (index < peak && underwaterSince === null) {
      underwaterSince = e.t;
    }
    const underwater = peak > 0 ? index / peak - 1 : 0;
    if (-underwater > maxDd) {
      maxDd = -underwater;
      maxDdAt = e.t;
    }
    points.push({
      t: e.t,
      index,
      returnPct: (index - 1) * 100,
      underwaterPct: underwater * 100,
      balance,
    });
  }

  if (underwaterSince !== null && points.length > 0) {
    longestUnderwater = Math.max(
      longestUnderwater,
      points[points.length - 1].t - underwaterSince,
    );
  }

  const last = points[points.length - 1];
  return {
    points,
    totalReturnPct: last ? (last.index - 1) * 100 : null,
    maxDrawdownPct: points.length ? maxDd * 100 : null,
    maxDrawdownAt: maxDdAt === null ? null : new Date(maxDdAt),
    currentDrawdownPct: last ? Math.abs(last.underwaterPct) : null,
    longestUnderwaterDays: longestUnderwater > 0 ? longestUnderwater / 86_400_000 : null,
    deposits: balanceOps.filter((d) => d.profit > 0).reduce((s, d) => s + d.profit, 0),
    withdrawals: balanceOps.filter((d) => d.profit < 0).reduce((s, d) => s + d.profit, 0),
  };
}

// ---------------------------------------------------------------------------
// Rolling windows
// ---------------------------------------------------------------------------

export type WindowStats = {
  label: string;
  trades: number;
  winRate: number | null;
  net: number;
  avgTrade: number | null;
  profitFactor: number | null;
  costs: number;
  from: Date | null;
  to: Date | null;
};

function windowStats(label: string, closed: Trade[]): WindowStats {
  const wins = closed.filter((t) => t.profit > 0);
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = closed.filter((t) => t.profit <= 0).reduce((s, t) => s + t.profit, 0);
  const net = closed.reduce((s, t) => s + t.profit, 0);
  return {
    label,
    trades: closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    net,
    avgTrade: closed.length ? net / closed.length : null,
    profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null,
    costs: closed.reduce((s, t) => s + t.swap + t.commission, 0),
    from: closed.length ? closed[0].closeTime : null,
    to: closed.length ? closed[closed.length - 1].closeTime : null,
  };
}

export function rollingWindows(trades: Trade[], sizes: number[] = [10, 30, 100]): WindowStats[] {
  const closed = trades
    .filter((t) => t.closeTime !== null)
    .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime());
  const out = sizes
    .filter((n) => closed.length > n)
    .map((n) => windowStats(`Last ${n}`, closed.slice(-n)));
  out.push(windowStats(`All ${closed.length}`, closed));
  return out;
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

const LAGOS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  hour: "2-digit",
  hour12: false,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type LagosParts = { hour: number; weekday: string; dayKey: string };

function lagosParts(d: Date): LagosParts {
  const parts = LAGOS.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    weekday: get("weekday"),
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const SESSIONS: Array<{ label: string; from: number; to: number }> = [
  { label: "Asia (00-07 UTC)", from: 0, to: 7 },
  { label: "London (07-12)", from: 7, to: 12 },
  { label: "London/NY overlap (12-16)", from: 12, to: 16 },
  { label: "New York (16-21)", from: 16, to: 21 },
  { label: "Late (21-24)", from: 21, to: 24 },
];

export function sessionOf(d: Date): string {
  const h = d.getUTCHours();
  return SESSIONS.find((s) => h >= s.from && h < s.to)?.label ?? SESSIONS[0].label;
}

export type Bucket = {
  key: string;
  label: string;
  trades: number;
  net: number;
  wins: number;
  winRate: number | null;
};

function bucketise(
  trades: Trade[],
  keyOf: (t: Trade) => string,
  labelOf: (key: string) => string,
  order?: (a: string, b: string) => number,
): Bucket[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = keyOf(t);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const rows = [...groups].map(([key, list]) => {
    const wins = list.filter((t) => t.profit > 0).length;
    return {
      key,
      label: labelOf(key),
      trades: list.length,
      net: list.reduce((s, t) => s + t.profit, 0),
      wins,
      winRate: list.length ? wins / list.length : null,
    };
  });
  return order ? rows.sort((a, b) => order(a.key, b.key)) : rows.sort((a, b) => b.trades - a.trades);
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Distributions = {
  byHour: Bucket[];
  byWeekday: Bucket[];
  bySession: Bucket[];
  bySymbol: Bucket[];
};

export function buildDistributions(trades: Trade[]): Distributions {
  const closed = trades.filter((t) => t.closeTime !== null);
  return {
    byHour: bucketise(
      closed,
      (t) => String(lagosParts(t.openTime).hour).padStart(2, "0"),
      (k) => `${k}:00`,
      (a, b) => Number(a) - Number(b),
    ),
    byWeekday: bucketise(
      closed,
      (t) => lagosParts(t.openTime).weekday,
      (k) => k,
      (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
    ),
    bySession: bucketise(
      closed,
      (t) => sessionOf(t.openTime),
      (k) => k,
      (a, b) =>
        SESSIONS.findIndex((s) => s.label === a) - SESSIONS.findIndex((s) => s.label === b),
    ),
    bySymbol: bucketise(closed, (t) => t.symbol, (k) => k),
  };
}

// ---------------------------------------------------------------------------
// Streaks, worst day, worst week
// ---------------------------------------------------------------------------

export type PeriodRow = { key: string; label: string; net: number; trades: number };

export type StreakSummary = {
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number; // positive = wins, negative = losses
  worstDay: PeriodRow | null;
  bestDay: PeriodRow | null;
  worstWeek: PeriodRow | null;
  bestWeek: PeriodRow | null;
  losingDays: number;
  winningDays: number;
  days: PeriodRow[];
};

function weekKeyOf(d: Date): { key: string; label: string } {
  // Monday start, computed on the Lagos calendar date.
  const { dayKey } = lagosParts(d);
  const [y, m, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day));
  const dow = (utc.getUTCDay() + 6) % 7; // 0 = Monday
  utc.setUTCDate(utc.getUTCDate() - dow);
  const key = utc.toISOString().slice(0, 10);
  return { key, label: `Week of ${key}` };
}

export function summariseStreaks(trades: Trade[]): StreakSummary {
  const closed = trades
    .filter((t) => t.closeTime !== null)
    .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime());

  let maxWin = 0;
  let maxLoss = 0;
  let run = 0;
  for (const t of closed) {
    const win = t.profit > 0;
    if (run === 0) run = win ? 1 : -1;
    else if (win && run > 0) run += 1;
    else if (!win && run < 0) run -= 1;
    else run = win ? 1 : -1;
    if (run > maxWin) maxWin = run;
    if (run < maxLoss) maxLoss = run;
  }

  const dayMap = new Map<string, PeriodRow>();
  const weekMap = new Map<string, PeriodRow>();
  for (const t of closed) {
    const { dayKey } = lagosParts(t.closeTime!);
    const day = dayMap.get(dayKey) ?? { key: dayKey, label: dayKey, net: 0, trades: 0 };
    day.net += t.profit;
    day.trades += 1;
    dayMap.set(dayKey, day);

    const wk = weekKeyOf(t.closeTime!);
    const week = weekMap.get(wk.key) ?? { key: wk.key, label: wk.label, net: 0, trades: 0 };
    week.net += t.profit;
    week.trades += 1;
    weekMap.set(wk.key, week);
  }

  const days = [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const weeks = [...weekMap.values()];
  const pick = (rows: PeriodRow[], worst: boolean) =>
    rows.length
      ? rows.reduce((best, r) => (worst ? (r.net < best.net ? r : best) : r.net > best.net ? r : best))
      : null;

  return {
    maxWinStreak: maxWin,
    maxLossStreak: Math.abs(maxLoss),
    currentStreak: run,
    worstDay: pick(days, true),
    bestDay: pick(days, false),
    worstWeek: pick(weeks, true),
    bestWeek: pick(weeks, false),
    losingDays: days.filter((d) => d.net < 0).length,
    winningDays: days.filter((d) => d.net > 0).length,
    days,
  };
}

// ---------------------------------------------------------------------------
// Combined exposure across accounts
//
// Combined equity is already on the overview. This is the other half: what a
// move in the underlying actually costs when every terminal is running the
// same EA on the same instrument.
// ---------------------------------------------------------------------------

export type ExposureLeg = {
  accountId: string;
  accountLabel: string;
  symbol: string;
  volume: number;
  positions: number;
  perUnitMove: number; // account currency per 1.00 of price movement
  direction: "buy" | "sell" | "mixed";
};

export type ExposureSummary = {
  legs: ExposureLeg[];
  bySymbol: Array<{
    symbol: string;
    volume: number;
    positions: number;
    perUnitMove: number;
    accounts: number;
  }>;
  totalPerUnitMove: number;
  totalEquity: number;
  // Adverse move in price units that would wipe the combined equity
  moveToZero: number | null;
  scenarios: Array<{ move: number; loss: number; pctOfEquity: number }>;
  peak: {
    perUnitMove: number;
    volume: number;
    legs: number;
    moveToZero: number | null;
    accounts: Array<{ label: string; legs: number; volume: number; perUnitMove: number; at: Date }>;
  } | null;
};

export type ExposureAccountInput = {
  id: string;
  label: string;
  equity: number;
  positions: LivePosition[];
  pointValues: Map<string, number>;
  // Worst historical cluster, used for the peak exposure scenario
  peakCluster: { legs: number; volume: number; symbol: string; at: Date } | null;
};

export function buildExposure(accounts: ExposureAccountInput[]): ExposureSummary {
  const legs: ExposureLeg[] = [];
  for (const a of accounts) {
    const bySymbol = new Map<string, LivePosition[]>();
    for (const p of a.positions) {
      const list = bySymbol.get(p.symbol) ?? [];
      list.push(p);
      bySymbol.set(p.symbol, list);
    }
    for (const [symbol, list] of bySymbol) {
      const pv = a.pointValues.get(symbol) ?? 0;
      const dirs = new Set(list.map((p) => p.type));
      const netVolume = list.reduce(
        (s, p) => s + (p.type === "buy" ? p.volume : -p.volume),
        0,
      );
      legs.push({
        accountId: a.id,
        accountLabel: a.label,
        symbol,
        volume: list.reduce((s, p) => s + p.volume, 0),
        positions: list.length,
        perUnitMove: Math.abs(dirs.size > 1 ? netVolume : list.reduce((s, p) => s + p.volume, 0)) * pv,
        direction: dirs.size > 1 ? "mixed" : (list[0].type as "buy" | "sell"),
      });
    }
  }

  const symbolMap = new Map<string, { volume: number; positions: number; perUnitMove: number; accounts: Set<string> }>();
  for (const l of legs) {
    const row = symbolMap.get(l.symbol) ?? {
      volume: 0,
      positions: 0,
      perUnitMove: 0,
      accounts: new Set<string>(),
    };
    row.volume += l.volume;
    row.positions += l.positions;
    row.perUnitMove += l.perUnitMove;
    row.accounts.add(l.accountId);
    symbolMap.set(l.symbol, row);
  }

  const totalPerUnitMove = legs.reduce((s, l) => s + l.perUnitMove, 0);
  const totalEquity = accounts.reduce((s, a) => s + a.equity, 0);

  // Peak scenario: every account back at its worst observed grid, at once.
  const peakAccounts = accounts
    .filter((a) => a.peakCluster !== null)
    .map((a) => {
      const c = a.peakCluster!;
      const pv = a.pointValues.get(c.symbol) ?? 0;
      return {
        label: a.label,
        legs: c.legs,
        volume: c.volume,
        perUnitMove: c.volume * pv,
        at: c.at,
      };
    });
  const peakPerUnit = peakAccounts.reduce((s, a) => s + a.perUnitMove, 0);

  return {
    legs,
    bySymbol: [...symbolMap].map(([symbol, r]) => ({
      symbol,
      volume: r.volume,
      positions: r.positions,
      perUnitMove: r.perUnitMove,
      accounts: r.accounts.size,
    })),
    totalPerUnitMove,
    totalEquity,
    moveToZero: totalPerUnitMove > 0 ? totalEquity / totalPerUnitMove : null,
    scenarios: [10, 25, 50, 100, 200].map((move) => ({
      move,
      loss: move * totalPerUnitMove,
      pctOfEquity: totalEquity > 0 ? (move * totalPerUnitMove) / totalEquity : 0,
    })),
    peak: peakAccounts.length
      ? {
          perUnitMove: peakPerUnit,
          volume: peakAccounts.reduce((s, a) => s + a.volume, 0),
          legs: peakAccounts.reduce((s, a) => s + a.legs, 0),
          moveToZero: peakPerUnit > 0 ? totalEquity / peakPerUnit : null,
          accounts: peakAccounts,
        }
      : null,
  };
}
