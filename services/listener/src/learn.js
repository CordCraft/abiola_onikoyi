import { q, setSetting } from './db.js';
import { rhythm } from './context.js';
import { minutesIn } from './util.js';
import { computeReplyStats, computeSignalStats, buildBehaviour } from './pure.js';

// Nightly: how does he actually behave? Reply latency and answer rate per person (his next
// hand-written reply after their message, last 30 days), dismiss and snooze rates per person
// and per kind, and his busiest hours. Written to JarvisPerson columns and JarvisSetting
// 'behaviour', which triage, the nudger and the advisor read.

export async function learnBehaviour({ now = Date.now() } = {}) {
  const r = await rhythm();
  const since = new Date(now - 30 * 864e5);
  const [messages, signals, persons, conns] = await Promise.all([
    q(`SELECT "threadKey", direction, sender, "isGroup", source, left(body, 600) AS body, "occurredAt" FROM "JarvisInbound" WHERE "occurredAt" > $1 AND "threadKey" IS NOT NULL`, [since]),
    q(`SELECT kind, status, "personKey" FROM "JarvisSignal" WHERE "createdAt" > $1 AND kind NOT IN ('plan')`, [since]),
    q(`SELECT key, name FROM "JarvisPerson"`),
    q(`SELECT account FROM "JarvisConnection"`).catch(() => []),
  ]);
  const ownAddresses = new Set(conns.map((c) => String(c.account || '').toLowerCase()).filter(Boolean));
  const replyStats = computeReplyStats(messages, { now, ownAddresses });
  const signalStats = computeSignalStats(signals);
  const names = new Map(persons.map((p) => [String(p.key).toLowerCase(), p.name || p.key]));
  const activeMinutes = messages
    .filter((m) => m.direction === 'out' && !String(m.body).startsWith('[auto] '))
    .map((m) => minutesIn(r.tz, new Date(m.occurredAt)));

  let written = 0;
  for (const p of persons) {
    const key = String(p.key).toLowerCase();
    const rs = replyStats.get(key);
    const ss = signalStats.byPerson.get(key);
    if (!rs && !ss) continue;
    const behaviour = {
      replySample: rs?.total || 0,
      answered: rs?.answered || 0,
      decided: ss?.decided || 0,
      snoozeRate: ss ? Math.round(ss.snoozeRate * 100) / 100 : null,
      learnedAt: new Date(now).toISOString(),
    };
    await q(
      `UPDATE "JarvisPerson" SET "medianReplyMins" = COALESCE($2::int, "medianReplyMins"), "answerRate" = COALESCE($3::float8, "answerRate"),
         "dismissRate" = COALESCE($4::float8, "dismissRate"), behaviour = $5, "updatedAt" = now() WHERE key = $1`,
      [p.key, rs?.medianReplyMins ?? null, rs?.answerRate ?? null, ss ? ss.dismissRate : null, JSON.stringify(behaviour)],
    );
    written += 1;
  }
  const b = buildBehaviour({ replyStats, signalStats, names, activeMinutes, now: new Date(now) });
  await setSetting('behaviour', b);
  return { people: written, behaviour: b };
}
