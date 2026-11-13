import { q, one, getSetting, setSetting } from './db.js';
import { sendPush } from './push.js';
import { rhythm } from './context.js';
import { minutesIn, dateKeyIn, tzOffsetMinutes } from './util.js';
import crypto from 'node:crypto';
import { digestDue, digestText, digestChanged } from './pure.js';

// Nothing held back or over the cap is dropped: it waits here and goes out as one bundled
// push after family time, after quiet hours, and every two hours while anything is waiting.

export function startOfDay(tz, d = new Date()) {
  const offset = tzOffsetMinutes(tz, d);
  return new Date(Date.parse(`${dateKeyIn(tz, d)}T00:00:00Z`) - offset * 60e3);
}

// What Jarvis closed since a moment (never counts things the owner closed by hand).
export async function closedSince(since) {
  return q(`SELECT title, "closedBy" FROM "JarvisLedger" WHERE "closedAt" >= $1 AND kind <> 'cleanup' AND "closedBy" <> 'manual' ORDER BY "closedAt" DESC`, [since]).catch(() => []);
}

// Signals that were never pushed (held by the gate or over a cap) and still need him.
export async function waitingCounts() {
  const rows = await q(
    `SELECT id, kind FROM "JarvisSignal"
     WHERE status = 'new' AND "pushedAt" IS NULL AND kind NOT IN ('fyi','plan') AND autonomy = 'ask' AND score >= 40
       AND "createdAt" > now() - interval '3 days' AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
  );
  const hash = crypto.createHash('sha1').update(rows.map((r) => r.id).sort().join(',')).digest('hex');
  return { replies: rows.filter((r) => r.kind === 'reply').length, other: rows.filter((r) => r.kind !== 'reply').length, hash };
}

export async function digestTick({ force = false } = {}) {
  const r = await rhythm();
  const waiting = await waitingCounts();
  const state = (await getSetting('digest_state', {})) || {};
  const total = waiting.replies + waiting.other;
  if (!force && !digestDue({ nowMin: minutesIn(r.tz), r, lastSentAt: state.lastSentAt, waiting: total })) return { sent: false, waiting: total };
  // Nothing new since the last bundle: stay quiet until something changes or 6 hours pass.
  if (!force && !digestChanged({ hash: waiting.hash, lastHash: state.hash, lastSentAt: state.lastSentAt })) return { sent: false, waiting: total, unchanged: true };
  const closed = (await closedSince(startOfDay(r.tz))).length;
  const body = digestText({ replies: waiting.replies, other: waiting.other, closed });
  if (!total) return { sent: false, waiting: 0 };
  await sendPush({ title: 'While you were busy', body, url: '/jarvis/signals', tag: 'jarvis-digest' });
  await setSetting('digest_state', { lastSentAt: new Date().toISOString(), last: body, hash: waiting.hash });
  return { sent: true, waiting: total, body };
}
