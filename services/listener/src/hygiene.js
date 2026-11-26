import { q, one, newId, getSetting, setSetting, schema, ensureColumns } from './db.js';
import { rhythm } from './context.js';
import { pushSignal } from './push.js';
import { clip, normWords, jaccard, higherPriority } from './util.js';

// Keeping the pile honest: tasks are not duplicated, signals close themselves when the owner
// (or a co-host) has already answered, old signals fade and expire, and co-hosts get the first
// go at what is theirs before the owner is disturbed.

export const OPEN_SIGNAL_STATUSES = ['new', 'pushed', 'snoozed', 'delegated'];
const DEDUPE_THRESHOLD = 0.55;

// ---- Tasks ----------------------------------------------------------------------------------

function validDate(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

// The one way the listener creates a task. A near-duplicate of an open task (same id from the
// brain, or titles that share most of their words) updates that task instead of adding another.
export async function createTaskDeduped({ title, dueDate = null, priority = 'medium', projectId = null, sameAsTaskId = '', threadId = null }) {
  const due = validDate(dueDate);
  const open = await q(
    `SELECT id, title, priority, "dueDate" FROM "JarvisTask"
     WHERE status IN ('todo','doing') AND "createdAt" > now() - interval '45 days'
     ORDER BY "createdAt" DESC LIMIT 400`,
  );
  let match = sameAsTaskId ? open.find((t) => t.id === sameAsTaskId) : null;
  if (!match) {
    const words = normWords(title);
    let best = 0;
    for (const t of open) {
      const sim = jaccard(words, normWords(t.title));
      if (sim >= DEDUPE_THRESHOLD && sim > best) {
        best = sim;
        match = t;
      }
    }
  }
  if (match) {
    await q(
      `UPDATE "JarvisTask" SET
         "dueDate" = CASE WHEN $2::timestamp IS NULL THEN "dueDate" WHEN "dueDate" IS NULL THEN $2::timestamp ELSE LEAST("dueDate", $2::timestamp) END,
         priority = $3, "updatedAt" = now()
       WHERE id = $1`,
      [match.id, due, higherPriority(match.priority, priority || 'medium')],
    );
    return { taskId: match.id, merged: true };
  }
  const id = newId();
  if (schema.ready) {
    await q(
      `INSERT INTO "JarvisTask" (id, "projectId", title, status, priority, "dueDate", source, "threadId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'todo', $4, $5, 'listener', $6, now(), now())`,
      [id, projectId, clip(title, 200), priority || 'medium', due, threadId],
    );
  } else {
    await q(
      `INSERT INTO "JarvisTask" (id, "projectId", title, status, priority, "dueDate", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'todo', $4, $5, now(), now())`,
      [id, projectId, clip(title, 200), priority || 'medium', due],
    );
  }
  return { taskId: id };
}

export async function openTasks(limit = 40) {
  return q(
    `SELECT id, title, "dueDate" FROM "JarvisTask" WHERE status IN ('todo','doing') ORDER BY "createdAt" DESC LIMIT $1`,
    [limit],
  ).catch(() => []);
}

// ---- Delegation (co-hosts) ------------------------------------------------------------------

export async function delegateProjects() {
  if (!schema.ready) return [];
  return q(
    `SELECT id, name, "delegateName", "delegateContact", "escalateMins", "delegateKinds" FROM "JarvisProject"
     WHERE "delegateName" IS NOT NULL AND "delegateName" <> ''`,
  ).catch(() => []);
}

export function delegateKindsOf(p) {
  return String(p?.delegateKinds || 'reply,followup').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Should a new signal of this kind on this project go to the co-host first?
export async function delegationFor(projectId, kind) {
  if (!projectId || !schema.ready) return null;
  const p = await one(
    `SELECT "delegateName", "escalateMins", "delegateKinds" FROM "JarvisProject" WHERE id = $1 AND "delegateName" IS NOT NULL AND "delegateName" <> ''`,
    [projectId],
  ).catch(() => null);
  if (!p || !delegateKindsOf(p).includes(kind)) return null;
  const mins = Number(p.escalateMins) > 0 ? Number(p.escalateMins) : 30;
  return { name: p.delegateName, mins };
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

function matchDelegate(sender, delegates) {
  const s = String(sender || '').toLowerCase().trim();
  if (!s) return null;
  for (const d of delegates) {
    const c = String(d.delegateContact || '').toLowerCase().trim();
    if (!c) continue;
    if (c.includes('@')) {
      if (s === c) return d;
    } else {
      const a = digitsOf(s);
      const b = digitsOf(c);
      if (a.length >= 7 && b.length >= 7 && (a === b || a.endsWith(b) || b.endsWith(a))) return d;
    }
  }
  return null;
}

// Delegated signals whose co-host did not handle them in time come back to the owner.
export async function escalateDelegated() {
  if (!schema.ready) return 0;
  const rows = await q(
    `UPDATE "JarvisSignal" SET status = 'new', "updatedAt" = now(),
       detail = COALESCE(detail, '') || ' ' || COALESCE(NULLIF("delegatedTo", ''), 'The co-host') || ' has not handled this after '
         || GREATEST(1, ROUND(EXTRACT(EPOCH FROM ("escalateAt" - "createdAt")) / 60))::int || ' min.'
     WHERE status = 'delegated' AND "escalateAt" < now() RETURNING id`,
  );
  for (const r of rows) await pushSignal(r.id).catch((e) => console.error('[hygiene] escalate push', e.message));
  return rows.length;
}

// ---- Auto-resolve ---------------------------------------------------------------------------

function hhmm(d, tz) {
  return new Date(d).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

// Deterministic: an answer from the owner (or the project's co-host) in a thread closes the
// reply and followup signals raised by earlier messages in that same thread.
export async function resolveFromReplies() {
  const cursor = (await getSetting('resolve_cursor', null)) || new Date(Date.now() - 3 * 864e5).toISOString();
  const rows = await q(
    `SELECT id, source, "threadKey", direction, sender, "isGroup", "occurredAt", "createdAt" FROM "JarvisInbound"
     WHERE "createdAt" > $1 AND "threadKey" IS NOT NULL ORDER BY "createdAt" ASC LIMIT 500`,
    [new Date(cursor)],
  );
  if (!rows.length) return 0;
  const delegates = await delegateProjects();
  const r = await rhythm();

  // Latest answer per (thread, who).
  const answers = new Map();
  for (const m of rows) {
    // In a group one message rarely answers everything said there, so groups
    // are left to the brain, which reads the message and lists what it settles.
    if (m.isGroup) continue;
    let who = null;
    if (m.direction === 'out') who = { key: 'owner', name: null };
    else {
      const d = delegates.length ? matchDelegate(m.sender, delegates) : null;
      if (d) who = { key: `d:${d.id}`, name: d.delegateName };
    }
    if (!who) continue;
    const k = `${m.threadKey}|${who.key}`;
    const prev = answers.get(k);
    if (!prev || new Date(m.occurredAt) > new Date(prev.at)) answers.set(k, { thread: m.threadKey, at: m.occurredAt, source: m.source, name: who.name });
  }

  let resolved = 0;
  for (const a of answers.values()) {
    const note = a.name ? `${a.name} replied` : `You replied on ${a.source === 'whatsapp' ? 'WhatsApp' : 'email'} at ${hhmm(a.at, r.tz)}`;
    const done = await q(
      `UPDATE "JarvisSignal" SET status = 'resolved', "decidedAt" = now(), "updatedAt" = now(), result = jsonb_build_object('note', $3::text)
       WHERE id IN (
         SELECT DISTINCT s.id FROM "JarvisSignal" s
         JOIN "JarvisInbound" i ON s."inboundIds" ? i.id
         WHERE i."threadKey" = $1 AND i."occurredAt" < $2
           AND s.status IN ('new','pushed','snoozed','delegated') AND s.kind IN ('reply','followup')
       ) RETURNING id`,
      [a.thread, new Date(a.at), note],
    );
    resolved += done.length;
  }
  await setSetting('resolve_cursor', new Date(rows[rows.length - 1].createdAt).toISOString());
  if (resolved) console.log(`[hygiene] ${resolved} signal(s) closed by replies`);
  return resolved;
}

// From the brain: signals and tasks the new messages show are already done or no longer needed.
// Only ids the brain was shown are accepted.
export async function applyResolved(list, { signalIds, taskIds }) {
  let n = 0;
  for (const it of list || []) {
    const reason = clip(String(it?.reason || '').trim() || 'Already handled', 300);
    if (it?.kind === 'signal' && signalIds.has(it.id)) {
      const rows = await q(
        `UPDATE "JarvisSignal" SET status = 'resolved', "decidedAt" = now(), "updatedAt" = now(), result = jsonb_build_object('note', $2::text)
         WHERE id = $1 AND status IN ('new','pushed','snoozed','delegated') RETURNING id`,
        [it.id, reason],
      );
      n += rows.length;
    } else if (it?.kind === 'task' && taskIds.has(it.id)) {
      const rows = schema.ready
        ? await q(`UPDATE "JarvisTask" SET status = 'done', "completedAt" = now(), "updatedAt" = now(), "closedReason" = $2 WHERE id = $1 AND status IN ('todo','doing') RETURNING id`, [it.id, reason])
        : await q(`UPDATE "JarvisTask" SET status = 'done', "completedAt" = now(), "updatedAt" = now() WHERE id = $1 AND status IN ('todo','doing') RETURNING id`, [it.id]);
      n += rows.length;
    }
  }
  if (n) console.log(`[hygiene] brain closed ${n} signal(s)/task(s) as already handled`);
  return n;
}

// ---- Ageing ---------------------------------------------------------------------------------

const DAYS_OLD = `GREATEST(1, CEIL(EXTRACT(EPOCH FROM (now() - "createdAt")) / 86400))::int`;

// Hourly: signals nobody acted on expire, stale listener tasks are archived.
export async function expirySweep() {
  if (!schema.ready) await ensureColumns().catch(() => {});
  const replies = await q(
    `UPDATE "JarvisSignal" SET status = 'expired', "decidedAt" = now(), "updatedAt" = now(),
       result = jsonb_build_object('note', 'Expired: nobody acted on it within ' || ${DAYS_OLD} || ' days')
     WHERE status IN ('new','pushed','snoozed') AND kind = 'reply'
       AND ("dueAt" < now() - interval '12 hours' OR "updatedAt" < now() - interval '3 days') RETURNING id`,
  );
  const others = await q(
    `UPDATE "JarvisSignal" SET status = 'expired', "decidedAt" = now(), "updatedAt" = now(),
       result = jsonb_build_object('note', 'Expired: nobody acted on it within ' || ${DAYS_OLD} || ' days')
     WHERE status IN ('new','pushed','snoozed') AND kind IN ('followup','opportunity','event','task')
       AND ("dueAt" < now() - interval '2 days' OR "updatedAt" < now() - interval '7 days') RETURNING id`,
  );
  let archived = [];
  if (schema.ready) {
    archived = await q(
      `UPDATE "JarvisTask" SET status = 'archived', "closedReason" = 'Auto-archived: 10 days overdue with no update', "updatedAt" = now()
       WHERE source = 'listener' AND status = 'todo' AND "dueDate" < now() - interval '10 days' AND "updatedAt" < now() - interval '10 days' RETURNING id`,
    );
  }
  const total = replies.length + others.length + archived.length;
  if (total) console.log(`[hygiene] expired ${replies.length + others.length} signal(s), archived ${archived.length} task(s)`);
  return { expired: replies.length + others.length, archived: archived.length };
}
