import { q, one, getSetting, setSetting } from './db.js';
import { sendPush } from './push.js';
import { rhythm } from './context.js';
import { minutesIn, dateKeyIn, tzOffsetMinutes } from './util.js';
import { digestDue, digestText } from './pure.js';

// Nothing held back or over the cap is dropped: it waits here and goes out as one bundled
// push after family time, after quiet hours, and every two hours while anything is waiting.

export function startOfDay(tz, d = new Date()) {
  const offset = tzOffsetMinutes(tz, d);
  return new Date(Date.parse(`${dateKeyIn(tz, d)}T00:00:00Z`) - offset * 60e3);
}

// What Jarvis closed since a moment (never counts things the owner closed by hand).
export async function closedSince(since) {
  return q(`SELECT title, "closedBy" FROM "JarvisLedger" WHERE "closedAt" >= $1 AND kind <> 'cleanup' AND "closedBy" <> 'manual' ORDER BY "closedAt" DESC`, [since]);
}

// Signals that were never pushed (held by the gate or over a cap) and still need him.
export async function waitingCounts() {
  const rows = await q(
    `SELECT kind FROM "JarvisSignal"
     WHERE status = 'new' AND "pushedAt" IS NULL AND kind NOT IN ('fyi','plan') AND autonomy = 'ask' AND score >= 40
       AND "createdAt" > now() - interval '3 days' AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
  );
  return { replies: rows.filter((r) => r.kind === 'reply').length, other: rows.filter((r) => r.kind !== 'reply').length };
}

export async function digestTick({ force = false } = {}) {
  const r = await rhythm();
  const waiting = await waitingCounts();
  const state = (await getSetting('digest_state', {})) || {};
  const total = waiting.replies + waiting.other;
  if (!force && !digestDue({ nowMin: minutesIn(r.tz), r, lastSentAt: state.lastSentAt, waiting: total })) return { sent: false, waiting: total };
  const closed = (await closedSince(startOfDay(r.tz))).length;
  const body = digestText({ ...waiting, closed });
  if (!total) return { sent: false, waiting: 0 };
  await sendPush({ title: 'While you were busy', body, url: '/jarvis/signals', tag: 'jarvis-digest' });
  await setSetting('digest_state', { lastSentAt: new Date().toISOString(), last: body });
  return { sent: true, waiting: total, body };
}
