import { parseHm } from './util.js';

// Pure decision helpers (no database, no network) so they can be unit tested.
// Anything that needs the database lives in reconcile.js, brain.js, executor.js, digest.js.

export const OPEN_STATUSES = ['new', 'pushed', 'snoozed', 'approved'];

// ---------- rhythm and the push gate ----------

// Saved settings win over learned hours; learned hours win over defaults. With alwaysOn the
// learned "last active" time never starts quiet hours early.
export function buildRhythm(defaults, saved = {}, learned = {}) {
  const alwaysOn = saved?.alwaysOn ?? defaults.alwaysOn;
  const fromLearned = {};
  if (learned?.firstActive) fromLearned.quietEnd = learned.firstActive;
  if (learned?.lastActive && !alwaysOn) fromLearned.quietStart = learned.lastActive;
  return { ...defaults, ...fromLearned, ...(saved || {}), alwaysOn, learned };
}

export function inWindow(nowMin, startMin, endMin) {
  return startMin <= endMin ? nowMin >= startMin && nowMin < endMin : nowMin >= startMin || nowMin < endMin;
}

// Whether a signal of this score may interrupt right now. counts = pushes in the last hour / day.
export function gateDecision(r, { nowMin, score, counts = { hour: 0, day: 0 } }) {
  const quiet = inWindow(nowMin, parseHm(r.quietStart, 22 * 60 + 30), parseHm(r.quietEnd, 6 * 60 + 30));
  const quietThreshold = Number(r.quietThreshold ?? 80);
  if (quiet && score < quietThreshold) return { ok: false, reason: 'quiet hours' };
  const family = inWindow(nowMin, parseHm(r.familyStart, 18 * 60 + 30), parseHm(r.familyEnd, 21 * 60 + 30));
  const familyThreshold = Number(r.familyThreshold ?? 70);
  if (family && score < familyThreshold) return { ok: false, reason: 'family time' };
  if (counts.day >= r.maxPushesPerDay && score < 90) return { ok: false, reason: 'daily cap' };
  if (counts.hour >= r.maxPushesPerHour && score < 85) return { ok: false, reason: 'hourly cap' };
  if (score < 45) return { ok: false, reason: 'low score, digest only' };
  return { ok: true };
}

// The bundled "While you were busy" push: after family time, after quiet hours, and every
// two hours while things wait. Never during family time or quiet hours themselves.
export function digestDue({ now = new Date(), nowMin, r, lastSentAt, waiting }) {
  if (!waiting || waiting <= 0) return false;
  const quiet = inWindow(nowMin, parseHm(r.quietStart, 22 * 60 + 30), parseHm(r.quietEnd, 6 * 60 + 30));
  const family = inWindow(nowMin, parseHm(r.familyStart, 18 * 60 + 30), parseHm(r.familyEnd, 21 * 60 + 30));
  if (quiet || family) return false;
  const last = lastSentAt ? new Date(lastSentAt).getTime() : 0;
  for (const end of [parseHm(r.familyEnd, 21 * 60 + 30), parseHm(r.quietEnd, 6 * 60 + 30)]) {
    const sinceEnd = (nowMin - end + 1440) % 1440;
    if (sinceEnd < 45 && last < now.getTime() - sinceEnd * 60e3) return true;
  }
  return !last || now.getTime() - last >= 2 * 3600e3;
}

export function digestText({ replies = 0, other = 0, closed = 0 }) {
  const parts = [];
  if (replies) parts.push(`${replies} repl${replies === 1 ? 'y' : 'ies'} owed`);
  if (other) parts.push(`${other} other item${other === 1 ? '' : 's'} waiting`);
  if (closed) parts.push(`${closed} done by Jarvis`);
  return parts.join(', ');
}

export function closeoutText({ closed = [], open = [], stopWork = false, familyStart = '18:30' }) {
  const bits = [];
  bits.push(closed.length ? `Jarvis closed ${closed.length} today: ${closed.slice(0, 4).join('; ')}${closed.length > 4 ? '...' : ''}.` : 'Nothing closed by Jarvis today.');
  if (open.length) bits.push(`Still open: ${open.slice(0, 3).join('; ')}.`);
  if (stopWork) bits.push(`Family time from ${familyStart}. I will keep watch.`);
  return bits.join(' ');
}

// ---------- titles, duplicates, merging ----------

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'on', 'in', 'at', 'by', 'with', 'from', 'please', 'is', 'are', 'be', 'it', 'this', 'that', 'my', 'me', 'his', 'her', 'their']);

export function titleTokens(s) {
  return [...new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  )];
}

// Dice coefficient over normalised word sets: 1 identical, 0 nothing shared.
export function titleSimilarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.length || !B.length) return 0;
  const setB = new Set(B);
  const shared = A.filter((t) => setB.has(t)).length;
  return (2 * shared) / (A.length + B.length);
}

export const DUPLICATE_THRESHOLD = 0.55;

// Groups of open tasks that are really one thing (same thread, or similar titles).
// The oldest (then highest priority) is kept, the rest are the duplicates to merge into it.
export function findDuplicateGroups(tasks, threshold = DUPLICATE_THRESHOLD) {
  const parent = tasks.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const sameThread = tasks[i].threadKey && tasks[i].threadKey === tasks[j].threadKey;
      if (sameThread || titleSimilarity(tasks[i].title, tasks[j].title) >= threshold) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  tasks.forEach((t, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  });
  const rank = { high: 0, medium: 1, low: 2 };
  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
    out.push({ keep: { id: g[0].id, title: g[0].title }, drop: g.slice(1).map((t) => ({ id: t.id, title: t.title })) });
  }
  return out;
}

// Which existing signal a new item on the same thread and kind should merge into: an open
// one first (newest), else one applied in the last 7 days. Resolved, expired, dismissed and
// undone signals are never merged into, so genuinely new activity starts a fresh card.
export function selectMergeTarget(rows, now = new Date()) {
  const byNewest = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status)).sort(byNewest);
  if (open.length) return open[0];
  const applied = rows
    .filter((r) => r.status === 'applied' && now.getTime() - new Date(r.decidedAt || r.updatedAt || 0).getTime() <= 7 * 864e5)
    .sort(byNewest);
  return applied[0] || null;
}

// ---------- closing ----------

// An outgoing message on the same thread after a reply or follow-up signal's trigger time
// closes that signal. signal.since is the latest inbound it came from (falls back to createdAt).
export function selectDeterministicCloses(signals, outgoing) {
  const out = [];
  for (const s of signals) {
    if (!['reply', 'followup'].includes(s.kind) || !s.threadKey) continue;
    const since = new Date(s.since || s.createdAt).getTime();
    const hit = outgoing
      .filter((o) => o.threadKey === s.threadKey && new Date(o.occurredAt).getTime() > since)
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))[0];
    if (hit) out.push({ signal: s, outgoing: hit });
  }
  return out;
}

// Keep only closes the model was actually offered (right id and type) with enough confidence.
export function acceptCloses(result, items, minConfidence = 0.75) {
  const offered = new Map(items.map((i) => [`${i.type}:${i.id}`, i]));
  const seen = new Set();
  const out = [];
  for (const c of result?.closes || []) {
    const key = `${c.type}:${c.id}`;
    if (!offered.has(key) || seen.has(key)) continue;
    if (!(Number(c.confidence) >= minConfidence)) continue;
    seen.add(key);
    out.push({ id: c.id, type: c.type, confidence: Number(c.confidence), evidence: String(c.evidence || '').slice(0, 240) });
  }
  return out;
}

// The people an outgoing message was addressed to: the phone digits of a one-to-one
// WhatsApp chat, or the email addresses of a mail's recipients.
export function personKeysForOutgoing(m) {
  if (String(m.threadKey || '').startsWith('wa:')) {
    const jid = m.threadKey.slice(3);
    if (/@g\.us$/.test(jid)) return [];
    const digits = jid.split('@')[0].split(':')[0];
    return digits ? [digits] : [];
  }
  const emails = String(m.recipients || '').toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  return [...new Set(emails)];
}
