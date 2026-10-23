import type { LivePosition } from "./data";

// Pure alert rules: thresholds, hysteresis and message text. No I/O, so the
// decisions can be replayed against stored snapshots outside Next. The
// delivery side lives in alerts.ts.

export const DD_LEVELS = [40, 55, 65] as const; // floating drawdown, % of balance
const DD_REARM = 15; // points below a level before it can fire again

// Margin level buffers above the broker's stop-out, tightest last.
export const MARGIN_BUFFERS = [400, 200, 100] as const;
const MARGIN_REARM = 200;

// The EA posts every 30 seconds. Weekends get a longer leash because the
// market is shut and a terminal restart is harmless until Sunday night.
export const STALE_MINUTES = 10;
export const STALE_MINUTES_WEEKEND = 60;

// Stop-out levels confirmed for each broker (see dukascopy-xauusd/FINDINGS.md).
const STOP_OUTS: Array<{ match: RegExp; level: number }> = [
  { match: /vantage/i, level: 20 },
  { match: /black\s*bull/i, level: 50 },
  { match: /exness/i, level: 0 },
];
const DEFAULT_STOP_OUT = 50; // unknown broker: assume the strict end

export function stopOutFor(broker: string, label?: string | null): number {
  const hay = `${broker} ${label ?? ""}`;
  return STOP_OUTS.find((s) => s.match.test(hay))?.level ?? DEFAULT_STOP_OUT;
}

export type AlertState = {
  dd: number; // highest drawdown level fired (0 = clear)
  margin: number; // index into MARGIN_BUFFERS + 1 (0 = clear)
  stale: boolean;
};

export const CLEAR_STATE: AlertState = { dd: 0, margin: 0, stale: false };

export function parseState(raw: unknown): AlertState {
  const r = (raw ?? {}) as Partial<AlertState>;
  return {
    dd: typeof r.dd === "number" ? r.dd : 0,
    margin: typeof r.margin === "number" ? r.margin : 0,
    stale: r.stale === true,
  };
}

export type Snapshot = {
  balance: number;
  equity: number;
  margin: number;
  marginLevel: number | null;
  positions: LivePosition[];
};

export type AlertEvent = {
  kind: "drawdown" | "margin" | "stale";
  level: number; // 0 for a recovery notice
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
};

export function floatingDrawdownPct(s: Snapshot): number {
  if (s.balance <= 0) return 0;
  return Math.max(0, ((s.balance - s.equity) / s.balance) * 100);
}

// Dollars of gold price movement against the net position before equity
// reaches the stop-out line. Contract size is inferred from the positions'
// own floating P/L, so it holds for any broker's gold spelling.
export function goldDistanceToStopOut(s: Snapshot, stopOut: number): number | null {
  let net = 0;
  const sizes: number[] = [];
  for (const p of s.positions) {
    net += p.type === "buy" ? p.volume : -p.volume;
    const move = p.type === "buy" ? p.currentPrice - p.openPrice : p.openPrice - p.currentPrice;
    if (Math.abs(move) > 0.05 && p.volume > 0) {
      const cs = p.profit / (move * p.volume);
      if (Number.isFinite(cs) && cs > 0) sizes.push(cs);
    }
  }
  if (Math.abs(net) < 1e-9) return null;
  sizes.sort((a, b) => a - b);
  const contract = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 100;
  const cushion = s.equity - (stopOut / 100) * s.margin;
  return Math.max(0, cushion / (Math.abs(net) * contract));
}

function crossedDd(dd: number): number {
  let level = 0;
  for (const l of DD_LEVELS) if (dd >= l) level = l;
  return level;
}

function crossedMargin(ml: number | null, stopOut: number): number {
  if (ml === null) return 0;
  let idx = 0;
  MARGIN_BUFFERS.forEach((b, i) => {
    if (ml <= stopOut + b) idx = i + 1;
  });
  return idx;
}

// Pure decision step: given the stored state and a fresh snapshot, return the
// next state and the notifications to send. No I/O, so it is unit testable.
export function evaluateSnapshot(
  name: string,
  state: AlertState,
  s: Snapshot,
  stopOut: number,
): { next: AlertState; events: AlertEvent[] } {
  const next = { ...state };
  const events: AlertEvent[] = [];
  const dd = floatingDrawdownPct(s);
  const distance = goldDistanceToStopOut(s, stopOut);
  const legs = s.positions.length;
  const distanceText =
    distance === null ? "" : ` About $${distance.toFixed(0)} of gold from stop-out.`;
  const equityText = `Equity $${s.equity.toFixed(0)} on balance $${s.balance.toFixed(0)}, ${legs} legs open.`;

  // Drawdown
  const ddLevel = crossedDd(dd);
  if (ddLevel > state.dd) {
    next.dd = ddLevel;
    events.push({
      kind: "drawdown",
      level: ddLevel,
      severity: ddLevel >= DD_LEVELS[DD_LEVELS.length - 1] ? "critical" : "warning",
      title: `${name}: drawdown ${dd.toFixed(0)}%`,
      body: `Floating drawdown passed ${ddLevel}%. ${equityText}${distanceText}`,
    });
  } else if (ddLevel < state.dd) {
    // Keep every level the drawdown is still within DD_REARM points of, so a
    // swing back across a line during the same sequence stays quiet.
    let armed = 0;
    for (const l of DD_LEVELS) if (l <= state.dd && dd > l - DD_REARM) armed = l;
    next.dd = armed;
    if (armed === 0) {
      events.push({
        kind: "drawdown",
        level: 0,
        severity: "info",
        title: `${name}: recovered`,
        body: `Floating drawdown back to ${dd.toFixed(0)}%. ${equityText}`,
      });
    }
  }

  // Margin level against this broker's stop-out
  const mIdx = legs > 0 ? crossedMargin(s.marginLevel, stopOut) : 0;
  if (mIdx > state.margin) {
    next.margin = mIdx;
    const buffer = MARGIN_BUFFERS[mIdx - 1];
    events.push({
      kind: "margin",
      level: mIdx,
      severity: mIdx >= MARGIN_BUFFERS.length ? "critical" : "warning",
      title: `${name}: margin level ${s.marginLevel?.toFixed(0)}%`,
      body: `Within ${buffer} points of the ${stopOut}% stop-out.${distanceText} ${equityText}`,
    });
  } else if (mIdx < state.margin) {
    const clearAbove = stopOut + MARGIN_BUFFERS[state.margin - 1] + MARGIN_REARM;
    if (s.marginLevel === null || legs === 0 || s.marginLevel > clearAbove) {
      next.margin = mIdx;
    }
  }

  // Any fresh post means the feed is alive again
  if (state.stale) {
    next.stale = false;
    events.push({
      kind: "stale",
      level: 0,
      severity: "info",
      title: `${name}: feed back`,
      body: `The terminal is reporting again. ${equityText}`,
    });
  }

  return { next, events };
}

// Weekend for gold: Friday 21:00 UTC to Sunday 22:00 UTC.
export function isWeekendClose(now: Date): boolean {
  const day = now.getUTCDay();
  const h = now.getUTCHours();
  return (day === 5 && h >= 21) || day === 6 || (day === 0 && h < 22);
}

export function staleMinutes(lastSeenAt: Date, now: Date): number {
  return (now.getTime() - lastSeenAt.getTime()) / 60_000;
}

export function isFeedStale(lastSeenAt: Date, now: Date): boolean {
  const limit = isWeekendClose(now) ? STALE_MINUTES_WEEKEND : STALE_MINUTES;
  return staleMinutes(lastSeenAt, now) > limit;
}
