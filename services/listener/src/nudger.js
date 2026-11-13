import { config } from './config.js';
import { q, getSetting, setSetting } from './db.js';
import { structured } from './llm.js';
import { rhythm, behaviour, OWNER_BRIEF } from './context.js';
import { clip } from './util.js';
import { saveSignal, upsertPerson } from './brain.js';
import { isAirbnbGuestNotification } from './hostfully.js';
import { nudgeStaleTasks } from './reconcile.js';
import {
  OPEN_STATUSES,
  selectNudgeCandidates,
  acceptNudges,
  pruneNudgeCounts,
  nudgeTitle,
  hostfullyHealthy,
  ownerAliases,
  behaviourText,
  fmtWithin,
  noDash,
  NUDGE_WINDOW_MS,
} from './pure.js';

// Watches his back: threads whose last message is from a real person, unanswered past a
// threshold (2 h for people he answers fast or who matter, 6 h otherwise). A batch goes to the
// model ("does this still need him?"), and the yes answers become "Still waiting on you" reply
// signals through the normal saveSignal path, so merging and the push gate apply. At most one
// nudge per thread per 24 h and two in total; after that a thread only rides in the digest.

const COUNTS_KEY = 'nudge_counts';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'needs_reply', 'topic', 'why', 'score', 'draft'],
        properties: {
          id: { type: 'string' },
          needs_reply: { type: 'boolean' },
          topic: { type: 'string' },
          why: { type: 'string' },
          score: { type: 'integer' },
          draft: { type: 'string' },
        },
      },
    },
  },
};

const RULES = `You are Jarvis, the owner's silent chief of staff. Below are conversations whose last message is from someone else and which he has not answered for a while. For each one decide whether it STILL needs a reply from him.
needs_reply true: a question, a request, a decision or an open loop that is waiting on him. false: the conversation ended naturally (thanks, ok, a done deal), it is an automated or bulk message, small talk that needs nothing, or it was clearly handled elsewhere.
topic: two to five words naming what it is about. why: one short line on what is waiting. score 0-100 for how much leaving it unanswered costs him: money, clients, family and partners rank high; idle chatter low.
draft: when needs_reply is true and a short reply is sensible, a brief reply in his voice (warm, direct, same language as the thread, no promises he did not make); otherwise "". Never use em dashes. Use only the ids given.`;

const own = (s) => String(s || '').toLowerCase();

// Addresses and numbers that are him, so his own mail to himself never counts as someone waiting.
async function ownAddresses() {
  const set = new Set();
  const conns = await q(`SELECT account FROM "JarvisConnection"`).catch(() => []);
  for (const c of conns) if (c.account) set.add(own(c.account));
  const wa = (await getSetting('whatsapp_status', {})) || {};
  if (wa.account) set.add(String(wa.account).replace(/\D/g, ''));
  return set;
}

function fmtCandidate(c, key, tz) {
  const m = c.last;
  const when = new Date(m.occurredAt).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const who = `${m.senderName || m.sender || 'unknown'}${c.person?.relation ? ` (${c.person.relation})` : ''}`;
  const where = m.source === 'whatsapp' ? (m.isGroup ? `WhatsApp group "${m.chatName || ''}"` : 'WhatsApp') : m.source;
  const earlier = (c.context || []).map((x) => `    ${x.direction === 'out' ? 'YOU' : x.senderName || x.sender}: ${clip(x.body, 200)}`).join('\n');
  return `[${key}] ${who} via ${where}${m.subject ? `, "${clip(m.subject, 100)}"` : ''}, ${when}, waiting ${fmtWithin(c.ageMins)}+\n${earlier ? `${earlier}\n` : ''}    ${m.senderName || m.sender}: ${clip(m.body, 900)}`;
}

export async function nudgeOnce({ now = Date.now() } = {}) {
  const summary = { candidates: 0, created: 0, checked: 0 };
  if (!config.anthropicKey && !globalThis.__jarvisFakeStructured) return summary;

  const since = new Date(now - NUDGE_WINDOW_MS - 3600e3);
  const rows = await q(
    `SELECT id, "threadKey", direction, sender, "senderName", subject, body, source, "isGroup", "chatName", "occurredAt", "connectionId", "externalId"
     FROM "JarvisInbound" WHERE "threadKey" IS NOT NULL AND "occurredAt" > $1 ORDER BY "occurredAt" ASC LIMIT 6000`,
    [since],
  );
  const byThread = new Map();
  for (const m of rows) (byThread.get(m.threadKey) || byThread.set(m.threadKey, []).get(m.threadKey)).push(m);
  const threads = [...byThread].map(([threadKey, messages]) => ({ threadKey, messages }));
  if (!threads.length) return summary;

  const [peopleRows, openSignals, decided, counts0, hostStatus, addrs, learned] = await Promise.all([
    q(`SELECT key, name, relation, importance, "medianReplyMins" FROM "JarvisPerson"`).catch(() => []),
    q(`SELECT DISTINCT "threadKey" FROM "JarvisSignal" WHERE "threadKey" IS NOT NULL AND status = ANY($1)`, [OPEN_STATUSES]),
    q(`SELECT "threadKey", max(GREATEST(COALESCE("decidedAt", 'epoch'), COALESCE("resolvedAt", 'epoch'), "updatedAt")) AS at FROM "JarvisSignal"
       WHERE "threadKey" IS NOT NULL AND status IN ('dismissed','resolved','applied','expired') AND "updatedAt" > $1 GROUP BY "threadKey"`, [since]),
    getSetting(COUNTS_KEY, {}),
    getSetting('hostfully_status', null),
    ownAddresses(),
    behaviour(),
  ]);
  const counts = pruneNudgeCounts(counts0 || {}, now);
  const people = new Map(peopleRows.map((p) => [own(p.key), p]));
  const r = await rhythm();
  const extra = String(process.env.OWNER_ALIASES || '').split(',').map((s) => s.trim());
  const aliases = ownerAliases(config.ownerName, [...extra, ...[...addrs].filter((a) => /^\d{6,}$/.test(a))]);

  const candidates = selectNudgeCandidates({
    threads,
    now,
    aliases,
    ownAddresses: addrs,
    people,
    openThreadKeys: new Set(openSignals.map((s) => s.threadKey)),
    decidedAt: new Map(decided.map((d) => [d.threadKey, new Date(d.at).getTime()])),
    counts,
    isAirbnbNotification: isAirbnbGuestNotification,
    hostfullyHealthy: hostfullyHealthy(hostStatus, now),
  });
  summary.candidates = candidates.length;
  if (!candidates.length) {
    if (JSON.stringify(counts) !== JSON.stringify(counts0 || {})) await setSetting(COUNTS_KEY, counts);
    return summary;
  }

  const offered = candidates.map((c, i) => ({ ...c, key: `t${i + 1}`, context: byThread.get(c.threadKey).filter((m) => m.id !== c.last.id).slice(-3) }));
  const learnedText = behaviourText(learned);
  const system = `${OWNER_BRIEF}\n\n${RULES}${learnedText ? `\n\nHow he works (learned):\n${learnedText}` : ''}`;
  const user = `Now: ${new Date(now).toLocaleString('en-GB', { timeZone: r.tz, dateStyle: 'full', timeStyle: 'short' })} (${r.tz}).\n\nConversations waiting on him:\n\n${offered.map((c) => fmtCandidate(c, c.key, r.tz)).join('\n\n')}`;

  let result;
  try {
    result = await structured({ model: config.triageModel, system, user, schema: SCHEMA, effort: 'low' });
  } catch (e) {
    console.error('[nudger] model call failed:', e.message);
    return summary;
  }
  const { yes, no } = acceptNudges(result, offered);
  const byKey = new Map(offered.map((o) => [o.key, o]));

  // Threads the model said no to are remembered against that message so they are not asked again.
  for (const key of no) {
    const c = byKey.get(key);
    counts[c.threadKey] = { ...(counts[c.threadKey] || { count: 0 }), checked: c.last.id, at: now };
    summary.checked += 1;
  }

  for (const v of yes) {
    const c = byKey.get(v.key);
    const m = c.last;
    const name = m.senderName || m.sender || 'someone';
    const waited = fmtWithin(c.ageMins);
    const item = {
      kind: 'reply',
      title: nudgeTitle(name, v.topic),
      detail: noDash(`${v.why} Waiting ${waited} and counting.`),
      why: `Unanswered for ${waited}${c.person?.relation ? ` (${c.person.relation})` : ''}`,
      score: v.score,
      project_id: '',
      same_as_signal_id: '',
      due_at: '',
      expires_at: '',
      person: { key: own(m.sender), name: m.senderName || '', relation: c.person?.relation || '', org: '' },
      calendar: { title: '', start: '', end: '', all_day: false, location: '', purpose: 'work', confirmed: false },
      task: { title: '', due_date: '', priority: 'medium' },
      reply: { text: v.draft || '' },
    };
    try {
      if (!m.isGroup) await upsertPerson(item, m);
      const saved = await saveSignal(item, [m.id], new Map([[m.id, m]]), r, learned);
      if (!saved) continue;
      const prev = counts[c.threadKey] || { count: 0 };
      counts[c.threadKey] = { count: Number(prev.count || 0) + 1, last: now, at: now };
      await q(`UPDATE "JarvisPerson" SET "lastNudgedAt" = now() WHERE key = $1`, [own(m.sender)]).catch(() => {});
      summary.created += 1;
    } catch (e) {
      console.error('[nudger] save failed:', e.message);
    }
  }
  await setSetting(COUNTS_KEY, pruneNudgeCounts(counts, now));
  return summary;
}

// Every 20 minutes: reply nudges, then the quiet task nudges.
export async function nudgeTick() {
  const replies = await nudgeOnce();
  const tasks = await nudgeStaleTasks().catch((e) => {
    console.error('[nudger] task nudges', e.message);
    return 0;
  });
  return { ...replies, tasks };
}
