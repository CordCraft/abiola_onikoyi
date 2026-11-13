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
  const quietThreshold = Number(r.quietThreshold ?? 70);
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

// The digest goes out only when the waiting set changed since the last one, or 6 hours passed.
export const DIGEST_REPEAT_MS = 6 * 3600e3;
export function digestChanged({ hash, lastHash, lastSentAt, now = Date.now() }) {
  if (!lastSentAt || !lastHash) return true;
  return hash !== lastHash || now - new Date(lastSentAt).getTime() >= DIGEST_REPEAT_MS;
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

export const DUPLICATE_THRESHOLD = 0.7;
export const SAME_THREAD_MIN_SIMILARITY = 0.4;

const wordsOf = (s) => String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
const normWord = (w) => {
  const l = w.toLowerCase();
  return l.length > 3 && l.endsWith('s') ? l.slice(0, -1) : l;
};

// Differing words that carry identity: a number, or a capitalised word that is not just the
// first word of the title. "Send invoice to Taslim" and "Send invoice to Bola" are different jobs.
function differsOnNameOrNumber(a, b) {
  const side = (title) => {
    const m = new Map();
    wordsOf(title).forEach((w, i) => {
      if (STOP.has(w.toLowerCase())) return;
      const n = normWord(w);
      const ident = /\d/.test(w) || (i > 0 && /^[A-Z]/.test(w));
      m.set(n, (m.get(n) || false) || ident);
    });
    return m;
  };
  const A = side(a);
  const B = side(b);
  for (const [n, ident] of A) if (!B.has(n) && ident) return true;
  for (const [n, ident] of B) if (!A.has(n) && ident) return true;
  return false;
}

// Whether two open tasks are really one thing. Same thread needs a loosely similar title;
// otherwise the titles must be very similar and not differ on a name or a number.
export function isDuplicateTask(a, b, threshold = DUPLICATE_THRESHOLD) {
  const sim = titleSimilarity(a.title, b.title);
  if (a.threadKey && a.threadKey === b.threadKey) return sim >= SAME_THREAD_MIN_SIMILARITY;
  return sim >= threshold && !differsOnNameOrNumber(a.title, b.title);
}

// Groups of open tasks that are really one thing. Each task is compared only with the first
// (oldest) member of a group, never transitively, so a chain of near matches cannot snowball.
export function findDuplicateGroups(tasks, threshold = DUPLICATE_THRESHOLD) {
  const sorted = [...tasks].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const groups = [];
  for (const t of sorted) {
    const g = groups.find((x) => isDuplicateTask(x[0], t, threshold));
    if (g) g.push(t);
    else groups.push([t]);
  }
  const rank = { high: 0, medium: 1, low: 2 };
  const out = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    const [first, ...rest] = g;
    rest.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
    out.push({ keep: { id: first.id, title: first.title }, drop: rest.map((t) => ({ id: t.id, title: t.title })) });
  }
  return out;
}

// Which existing signal a new item on the same thread and kind should merge into: only an
// open one (newest). Applied, resolved, expired, dismissed and undone signals are never merged
// into, so genuinely new activity on the thread starts a fresh card that pushes normally.
export function selectMergeTarget(rows) {
  const byNewest = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  return rows.filter((r) => OPEN_STATUSES.includes(r.status)).sort(byNewest)[0] || null;
}

// ---------- closing ----------

// Hostfully scheduled/automated messages are stored as outgoing with this body prefix.
export const AUTO_PREFIX = '[auto] ';
export const isAutoMessage = (m) => String(m?.body || '').startsWith(AUTO_PREFIX);
export const CHECKIN_RE = /check-?\s?in|door ?code|access (code|details|instructions)|lock ?box|wi-?fi|directions|arrival (details|instructions)|house rules|key (pick|handover|collect)/i;

export const MIN_CLOSE_BODY = 12;
export const isWhatsAppGroup = (threadKey) => /^wa:.*@g\.us$/.test(String(threadKey || ''));
const substantive = (o) => {
  const body = String(o.body || '').replace(AUTO_PREFIX, '').trim();
  return body.length >= MIN_CLOSE_BODY && !isAckOnly(body);
};

// A substantive outgoing message on the same thread after a reply or follow-up signal's
// trigger time closes that signal. signal.since is the latest inbound it came from (falls back
// to createdAt). Not decided here (the model pass handles them): WhatsApp groups, and follow-ups
// that came from his own promise (signal.ownPromise), where a later message proves little.
// overrides.reopenedAt(signal) returns the time the owner undid a close, if any: only evidence
// after it counts.
export function selectDeterministicCloses(signals, outgoing, { reopenedAt = () => null } = {}) {
  const out = [];
  for (const s of signals) {
    if (!['reply', 'followup'].includes(s.kind) || !s.threadKey) continue;
    if (isWhatsAppGroup(s.threadKey) || s.isGroup) continue;
    if (s.kind === 'followup' && s.ownPromise) continue;
    const reopened = reopenedAt(s);
    const since = Math.max(new Date(s.since || s.createdAt).getTime(), reopened ? new Date(reopened).getTime() : 0);
    const checkin = CHECKIN_RE.test(`${s.title || ''} ${s.detail || ''}`);
    const hit = outgoing
      // Hostfully's automated messages are not him replying; they only settle check-in detail items.
      .filter((o) => !isAutoMessage(o) || checkin)
      .filter((o) => substantive(o))
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

// ---------- shared text helpers ----------

// The owner forbids em dashes in anything written for him; model text is cleaned on the way in.
export const noDash = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ');

const HOUR = 3600e3;
const DAY = 864e5;

// ---------- the nudger (threads still waiting on him) ----------

export const PRIORITY_RELATIONS = ['client', 'family', 'partner', 'team', 'investor'];
export const NUDGE_FAST_MS = 2 * HOUR;
export const NUDGE_SLOW_MS = 6 * HOUR;
export const NUDGE_WINDOW_MS = 3 * DAY;
export const NUDGE_GAP_MS = 24 * HOUR;
export const NUDGE_MAX_PER_THREAD = 2;
export const NUDGE_BATCH = 15;

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|newsletter|news|updates?|alerts?|automated|auto-?reply|system|marketing|digest|noreply\+.*)$/i;
const AUTOMATED_DOMAIN = /@(mail|email|e|news|newsletter|notify|notifications|bounce|bounces|em\d*|send|mailer|mg|t)\.[a-z0-9.-]+$/i;
const BULK_BODY = /unsubscribe|view (this email )?in (your )?browser|manage (your )?(email )?preferences|do not reply to this (email|message)|this is an automated (message|email)/i;
const ACK_ONLY = /^(ok(ay)?|thanks?( you)?( so much)?|thank you|noted|great|cool|nice|got it|sure|alright|yes|no problem|will do|amen|lol|haha|[\p{Extended_Pictographic}\s]+)[.! ]*$/iu;

// Newsletters, no-reply addresses and bulk mail: never worth a nudge.
export function isAutomatedSender(m) {
  const sender = String(m?.sender || '').toLowerCase();
  if (sender.includes('@')) {
    const local = sender.split('@')[0];
    if (AUTOMATED_LOCAL.test(local) || AUTOMATED_DOMAIN.test(sender)) return true;
    if (BULK_BODY.test(String(m?.body || '')) && String(m?.body || '').length > 400) return true;
  }
  return false;
}

export const isAckOnly = (body) => {
  const t = String(body || '').trim();
  return t.length <= 30 && ACK_ONLY.test(t);
};

// A group message counts only when it names the owner (his name, a handle, or his number).
export function mentionsOwner(body, aliases = []) {
  const text = String(body || '');
  for (const a of aliases) {
    const alias = String(a || '').trim();
    if (alias.length < 3) continue;
    if (/^\d+$/.test(alias)) {
      if (text.includes(`@${alias}`)) return true;
      continue;
    }
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}])@?${esc}([^\\p{L}]|$)`, 'iu').test(text)) return true;
  }
  return false;
}

export function ownerAliases(ownerName, extra = []) {
  const parts = String(ownerName || '').split(/\s+/).filter((p) => p.length >= 3);
  return [...new Set([...parts, ...extra.filter(Boolean)].map((s) => String(s)))];
}

export function nudgeThresholdMs(person) {
  const fast = person && person.medianReplyMins != null && Number(person.medianReplyMins) < 60;
  return fast || PRIORITY_RELATIONS.includes(String(person?.relation || '').toLowerCase()) ? NUDGE_FAST_MS : NUDGE_SLOW_MS;
}

// Counts are kept per thread for a week: { count, last (ms), checked (inbound id the model said no to), at }.
export function pruneNudgeCounts(counts, now = Date.now()) {
  const out = {};
  for (const [k, v] of Object.entries(counts || {})) {
    const stamp = Math.max(Number(v?.last || 0), Number(v?.at || 0));
    if (stamp && now - stamp <= 7 * DAY) out[k] = v;
  }
  return out;
}

// threads: [{ threadKey, messages: [{ id, direction, sender, senderName, body, subject, source, isGroup, occurredAt }] }]
// people: Map of lowercase key to { medianReplyMins, relation, importance, name }.
export function selectNudgeCandidates({
  threads,
  now = Date.now(),
  aliases = [],
  ownAddresses = new Set(),
  people = new Map(),
  openThreadKeys = new Set(),
  decidedAt = new Map(),
  counts = {},
  isAirbnbNotification = () => false,
  hostfullyHealthy = false,
  max = NUDGE_BATCH,
}) {
  const at = (m) => new Date(m.occurredAt).getTime();
  const out = [];
  for (const t of threads) {
    const msgs = [...t.messages].sort((a, b) => at(a) - at(b));
    let lastIn = null;
    for (const m of msgs) if (m.direction === 'in') lastIn = m;
    if (!lastIn) continue;
    const age = now - at(lastIn);
    if (age > NUDGE_WINDOW_MS) continue;
    const sender = String(lastIn.sender || '').toLowerCase();
    if (ownAddresses.has(sender)) continue;
    // He replied by hand after it. Hostfully's automated messages do not count as him replying.
    if (msgs.some((m) => m.direction === 'out' && !isAutoMessage(m) && at(m) > at(lastIn))) continue;
    if (isAutomatedSender(lastIn)) continue;
    if (hostfullyHealthy && isAirbnbNotification(lastIn)) continue;
    if (isAckOnly(lastIn.body)) continue;
    if (lastIn.isGroup && !mentionsOwner(lastIn.body, aliases)) continue;
    if (openThreadKeys.has(t.threadKey)) continue;
    if ((decidedAt.get(t.threadKey) || 0) > at(lastIn)) continue;
    const c = counts[t.threadKey];
    if (c && (Number(c.count || 0) >= NUDGE_MAX_PER_THREAD || (c.last && now - Number(c.last) < NUDGE_GAP_MS) || c.checked === lastIn.id)) continue;
    const person = people.get(sender) || null;
    const threshold = nudgeThresholdMs(person);
    if (age < threshold) continue;
    out.push({ threadKey: t.threadKey, last: lastIn, ageMins: Math.round(age / 60e3), thresholdMins: Math.round(threshold / 60e3), person, sender });
  }
  const weight = (c) => (PRIORITY_RELATIONS.includes(String(c.person?.relation || '').toLowerCase()) ? 1 : 0);
  out.sort((a, b) => weight(b) - weight(a) || b.ageMins - a.ageMins);
  return out.slice(0, max);
}

// Keep only verdicts for offered candidates. yes = still needs him (score high enough); no = checked and fine.
export function acceptNudges(result, offered, minScore = 40) {
  const ids = new Set(offered.map((o) => o.key));
  const seen = new Set();
  const yes = [];
  const no = [];
  for (const v of result?.verdicts || []) {
    if (!ids.has(v.id) || seen.has(v.id)) continue;
    seen.add(v.id);
    const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
    if (v.needs_reply === true && score >= minScore) {
      yes.push({ key: v.id, topic: noDash(v.topic).trim().slice(0, 60), why: noDash(v.why).trim().slice(0, 240), score, draft: noDash(v.draft).trim().slice(0, 1200) });
    } else {
      no.push(v.id);
    }
  }
  return { yes, no };
}

export const nudgeTitle = (who, topic) => `Still waiting on you: ${who || 'someone'}${topic ? `, ${topic}` : ''}`.slice(0, 140);

// ---------- stalled tasks ----------

export const STALL_DAYS = 3;
export const STALL_MAX_PER_DAY = 5;

export const STALL_MAX_PER_TASK = 2;
export const STALL_ACTIVE_DAYS = 14;

// Open tasks untouched for 3 days that are overdue or had activity in the last 14 days (the
// rest have been abandoned quietly), with no nudge in the last 3 days (any status), no open
// nudge, and fewer than two nudges since the task last changed. tasks: { id, status, updatedAt, dueDate }.
export function selectStalledTasks(tasks, nudges, { now = Date.now(), alreadyToday = 0 } = {}) {
  const room = Math.max(0, STALL_MAX_PER_DAY - alreadyToday);
  const blocked = new Set();
  const byTask = new Map();
  for (const n of nudges) {
    const open = OPEN_STATUSES.includes(n.status);
    const at = new Date(n.createdAt).getTime();
    if (open || now - at < STALL_DAYS * DAY) blocked.add(n.threadKey);
    (byTask.get(n.threadKey) || byTask.set(n.threadKey, []).get(n.threadKey)).push(at);
  }
  return tasks
    .filter((t) => {
      if (t.status === 'done') return false;
      const touched = new Date(t.updatedAt).getTime();
      if (now - touched < STALL_DAYS * DAY || blocked.has(`task:${t.id}`)) return false;
      const overdue = t.dueDate && new Date(t.dueDate).getTime() < now;
      if (!overdue && now - touched > STALL_ACTIVE_DAYS * DAY) return false;
      return (byTask.get(`task:${t.id}`) || []).filter((at) => at > touched).length < STALL_MAX_PER_TASK;
    })
    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
    .slice(0, room);
}

// ---------- learning how he works ----------

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// messages: [{ threadKey, direction, sender, isGroup, source, body, occurredAt }], any order.
// Per person: minutes from their message to his next hand-written reply, and how many were answered.
export function computeReplyStats(messages, { now = Date.now(), ownAddresses = new Set() } = {}) {
  const byThread = new Map();
  for (const m of messages) {
    if (!m.threadKey || m.isGroup || m.source === 'hostfully') continue;
    (byThread.get(m.threadKey) || byThread.set(m.threadKey, []).get(m.threadKey)).push(m);
  }
  const stats = new Map();
  const slot = (key) => stats.get(key) || stats.set(key, { latencies: [], answered: 0, total: 0 }).get(key);
  for (const list of byThread.values()) {
    list.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
    let pending = null;
    for (const m of list) {
      const at = new Date(m.occurredAt).getTime();
      if (m.direction === 'in') {
        const key = String(m.sender || '').toLowerCase();
        if (!key || ownAddresses.has(key) || isAutomatedSender(m) || isAckOnly(m.body)) continue;
        if (!pending) pending = { at, key };
      } else if (!isAutoMessage(m) && pending) {
        const mins = (at - pending.at) / 60e3;
        const s = slot(pending.key);
        s.total += 1;
        if (mins <= 7 * 1440) {
          s.answered += 1;
          s.latencies.push(mins);
        }
        pending = null;
      }
    }
    if (pending && now - pending.at > DAY) slot(pending.key).total += 1;
  }
  const out = new Map();
  for (const [key, s] of stats) {
    out.set(key, { medianReplyMins: s.latencies.length ? Math.round(median(s.latencies)) : null, answerRate: s.total ? s.answered / s.total : null, answered: s.answered, total: s.total });
  }
  return out;
}

// signals: [{ kind, status, personKey }]. Decided = acted on, dismissed or snoozed.
export function computeSignalStats(signals, { minPerson = 3, minKind = 5 } = {}) {
  const tally = (map, key) => map.get(key) || map.set(key, { decided: 0, dismissed: 0, snoozed: 0 }).get(key);
  const people = new Map();
  const kinds = new Map();
  for (const s of signals) {
    if (!['applied', 'dismissed', 'snoozed'].includes(s.status)) continue;
    const targets = [tally(kinds, s.kind)];
    if (s.personKey) targets.push(tally(people, String(s.personKey).toLowerCase()));
    for (const t of targets) {
      t.decided += 1;
      if (s.status === 'dismissed') t.dismissed += 1;
      if (s.status === 'snoozed') t.snoozed += 1;
    }
  }
  const rate = (t) => ({ ...t, dismissRate: t.dismissed / t.decided, snoozeRate: t.snoozed / t.decided });
  const byPerson = new Map([...people].filter(([, t]) => t.decided >= minPerson).map(([k, t]) => [k, rate(t)]));
  const byKind = Object.fromEntries([...kinds].filter(([, t]) => t.decided >= minKind).map(([k, t]) => [k, rate(t)]));
  return { byPerson, byKind };
}

export function busiestHours(minutesOfDay, top = 3) {
  const hist = new Array(24).fill(0);
  for (const m of minutesOfDay) hist[Math.floor(m / 60) % 24] += 1;
  return hist.map((n, h) => [h, n]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, top).map(([h]) => `${String(h).padStart(2, '0')}:00`);
}

const KIND_LABEL = { opportunity: 'opportunity cards', followup: 'follow-up cards', task: 'task cards', reply: 'reply cards', event: 'calendar cards', fyi: 'FYI cards', nudge: 'nudges', plan: 'plan cards' };

const withinMins = (m) => (m <= 10 ? 10 : m < 60 ? Math.ceil(m / 5) * 5 : m <= 90 ? 60 : Math.ceil(m / 60) * 60);
export const fmtWithin = (m) => {
  const v = withinMins(m);
  return v < 60 ? `${v} min` : v === 60 ? 'an hour' : `${Math.round(v / 60)} hours`;
};

// The compact "how he works" record stored in JarvisSetting 'behaviour'.
export function buildBehaviour({ replyStats, signalStats, names = new Map(), activeMinutes = [], now = new Date() }) {
  const fastAnswer = [...replyStats]
    .filter(([, s]) => s.medianReplyMins != null && s.answered >= 3 && s.medianReplyMins <= 60)
    .sort((a, b) => a[1].medianReplyMins - b[1].medianReplyMins)
    .slice(0, 6)
    .map(([key, s]) => ({ key, name: names.get(key) || key, medianMins: s.medianReplyMins, answerRate: Math.round(s.answerRate * 100) / 100, sample: s.answered }));
  const dismissedKinds = Object.entries(signalStats.byKind)
    .filter(([, t]) => t.dismissRate >= 0.5)
    .sort((a, b) => b[1].dismissRate - a[1].dismissRate)
    .map(([kind, t]) => ({ kind, rate: Math.round(t.dismissRate * 100) / 100, n: t.decided }));
  const busiest = busiestHours(activeMinutes);
  const summary = [
    ...fastAnswer.slice(0, 4).map((p) => `He usually answers ${p.name} within ${fmtWithin(p.medianMins)}.`),
    ...dismissedKinds.slice(0, 3).map((k) => `He dismisses ${KIND_LABEL[k.kind] || `${k.kind} cards`} ${Math.round(k.rate * 100)}% of the time (${k.n} seen).`),
    ...(busiest.length ? [`He is most active around ${busiest.join(', ')}.`] : []),
  ];
  return { updatedAt: new Date(now).toISOString(), fastAnswer, dismissedKinds, busiest, summary };
}

// Often-dismissed kinds score lower so they interrupt less. Events are never marked down.
export function adjustScore(score, kind, behaviour) {
  if (kind === 'event') return score;
  const hit = (behaviour?.dismissedKinds || []).find((k) => k.kind === kind && k.rate >= 0.6 && k.n >= 10);
  return hit ? Math.max(0, score - 10) : score;
}

export function behaviourText(b) {
  return Array.isArray(b?.summary) && b.summary.length ? b.summary.join('\n') : '';
}

// ---------- the advisor ----------

export function parseAdvice(result, max = 5) {
  const out = [];
  for (const it of result?.suggestions || []) {
    const title = noDash(it?.title).trim().slice(0, 120);
    const why = noDash(it?.why).trim().slice(0, 320);
    const how = noDash(it?.how).trim().slice(0, 420);
    if (!title || !how) continue;
    if (out.some((o) => titleSimilarity(o.title, title) >= 0.7)) continue;
    out.push({ title, why, how });
    if (out.length >= max) break;
  }
  return out;
}

export function adviceText(items) {
  return items.map((s, i) => `${i + 1}. ${s.title}\nWhy: ${s.why}\nHow: ${s.how}`).join('\n\n');
}

// ---------- hostfully health ----------

// Hostfully is the source of truth for guest messages only while its poll is succeeding.
export function hostfullyHealthy(status, now = Date.now(), maxAgeMs = 15 * 60e3) {
  if (!status || status.ok !== true || !status.lastRunAt) return false;
  const t = new Date(status.lastRunAt).getTime();
  return Number.isFinite(t) && now - t < maxAgeMs;
}
