import "server-only";
import { prisma } from "@/lib/prisma";
import { sendPushToAll } from "@/lib/jarvis/push";
import {
  evaluateSnapshot,
  isFeedStale,
  parseState,
  staleMinutes,
  stopOutFor,
  type AlertEvent,
  type Snapshot,
} from "./alert-rules";

export {
  DD_LEVELS,
  MARGIN_BUFFERS,
  STALE_MINUTES,
  stopOutFor,
} from "./alert-rules";

// Phone alerts for the three things that can lose an account while nobody is
// looking: a deep floating drawdown, margin level closing in on the broker's
// stop-out, and the feed going quiet (the terminal, the VPS or the EA died).
//
// State lives in TradingAccount.alertState so each level fires once on the
// way down and re-arms only after a real recovery (hysteresis), instead of
// buzzing every 30 seconds while equity hovers on a line. Every alert sent is
// also logged to TradingAlert for the dashboard.

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

type AccountForAlerts = {
  id: string;
  broker: string;
  label: string | null;
  alertState?: unknown;
};

function displayName(a: { broker: string; label: string | null }) {
  return a.label || a.broker;
}

async function deliver(accountId: string, events: AlertEvent[]) {
  for (const e of events) {
    const push = await sendPushToAll({
      title: e.title,
      body: e.body,
      url: `/dashboard/trading/${accountId}`,
      tag: `trading-${accountId}-${e.kind}`,
    }).catch((err) => {
      console.error("trading alert: push failed", err);
      return { sent: 0, pruned: 0, failed: 1 };
    });
    await prisma.tradingAlert.create({
      data: {
        accountId,
        kind: e.kind,
        level: e.level,
        severity: e.severity,
        title: e.title,
        body: e.body,
        delivered: push.sent,
      },
    });
  }
}

// Called by the ingest route after every post. Never throws: an alert bug must
// not stop telemetry from landing.
export async function checkSnapshotAlerts(account: AccountForAlerts, s: Snapshot) {
  try {
    const state = parseState(account.alertState);
    const { next, events } = evaluateSnapshot(
      displayName(account),
      state,
      s,
      stopOutFor(account.broker, account.label),
    );
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      await prisma.tradingAccount.update({
        where: { id: account.id },
        data: { alertState: next },
      });
    }
    if (events.length) await deliver(account.id, events);
  } catch (err) {
    console.error("trading alert: snapshot check failed", err);
  }
}

// Called on a schedule: the only way to notice a post that never arrives.
export async function checkHeartbeats(now: Date = new Date()) {
  const accounts = await prisma.tradingAccount.findMany();
  const fired: string[] = [];
  for (const a of accounts) {
    const state = parseState(a.alertState);
    if (state.stale || !isFeedStale(a.lastSeenAt, now)) continue;
    const mins = Math.round(staleMinutes(a.lastSeenAt, now));
    const open = a.positionCount > 0 ? `${a.positionCount} legs were open` : "It was flat";
    const event: AlertEvent = {
      kind: "stale",
      level: 1,
      severity: a.positionCount > 0 ? "critical" : "warning",
      title: `${displayName(a)}: no data for ${mins} min`,
      body: `The terminal, the EA or the VPS has stopped reporting. ${open}, equity $${a.equity.toFixed(0)} at last report. Check the VPS.`,
    };
    await prisma.tradingAccount.update({
      where: { id: a.id },
      data: { alertState: { ...state, stale: true } },
    });
    await deliver(a.id, [event]);
    fired.push(a.id);
  }
  return { checked: accounts.length, fired };
}

export async function recentAlerts(limit = 12) {
  return prisma.tradingAlert.findMany({
    orderBy: { at: "desc" },
    take: limit,
    include: { account: { select: { label: true, broker: true } } },
  });
}
