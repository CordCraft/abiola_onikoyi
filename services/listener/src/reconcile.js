import { config } from './config.js';
import { q, one, newId, getSetting, setSetting, v3State } from './db.js';
import { structured } from './llm.js';
import { clip } from './util.js';
import { pushSignal } from './push.js';
import { OPEN_STATUSES, selectDeterministicCloses, acceptCloses, findDuplicateGroups, selectStalledTasks, isAutoMessage } from './pure.js';

// Closes loops. An outgoing message on a thread closes the reply it answers; a model pass
// reads recent messages against the open signals and tasks; housekeeping expires what has
// stopped mattering. Every close writes a JarvisLedger row and can be undone.
// This module must not import executor.js or brain.js (they import it).

const CLEANUP_KEY = 'v3_cleanup_proposed';
const UNDO_KEY = 'v3_undo';
const MODEL_CURSOR_KEY = 'v3_reconcile_cursor';
const MODEL_CAP = 150;
const ROW_LIMIT = 400;
const REDO_AFTER_DISMISS_MS = 3 * 864e5;
const TRIAGE_DEBOUNCE_MS = 5 * 60e3;

// ---------- undo memory ----------
// What the owner undid must stay undone: reopened[type:id] is when he reopened it (only newer
// evidence may close it again), prev[taskId] is the status a task had before it was closed.
async function loadUndo() {
  const u = (await getSetting(UNDO_KEY, null)) || {};
  return { reopened: u.reopened || {}, prev: u.prev || {} };
}
async function saveUndo(u) {
  const cutoff = Date.now() - 90 * 864e5;
  const reopened = Object.fromEntries(Object.entries(u.reopened).filter(([, at]) => new Date(at).getTime() > cutoff));
  await setSetting(UNDO_KEY, { reopened, prev: u.prev });
}
const reopenedAtOf = (undo, type, id) => undo.reopened[`${type}:${id}`] || null;
// An item the owner reopened is only offered for closing again when something newer than that arrived.
const notOverridden = (undo, newestAt) => (it) => {
  const at = reopenedAtOf(undo, it.type, it.id);
  return !at || (newestAt && newestAt > new Date(at).getTime());
};

export { OPEN_STATUSES };

const CLOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['closes'],
  properties: {
    closes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'confidence', 'evidence'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['signal', 'task'] },
          confidence: { type: 'number' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

const CLOSE_RULES = `You are Jarvis checking which open items the owner has ALREADY dealt with. You get a list of open signals and tasks (each with an id) and the recent messages: what the owner wrote (YOU), and messages from other people in the same threads (including someone else answering on his behalf, such as a co-host).
Return an item in "closes" only when the messages clearly show it is done: he sent the thing, answered the question, confirmed, paid, or someone else already handled it. Being discussed is not done. A promise to do it later is not done.
confidence 0 to 1: 0.9 and above for explicit proof, 0.75 for strong implication, below 0.75 means do not list it. evidence: one short line naming the message that proves it (who, what). Only use ids from the list, with their type. Never use em dashes.`;

// ---------- ledger and primitives ----------

export async function writeLedger({ kind, title, summary = null, personKey = null, threadKey = null, signalId = null, taskId = null, closedBy, evidence = null }) {
  await q(
    `INSERT INTO "JarvisLedger" (id, kind, title, summary, "personKey", "threadKey", "signalId", "taskId", "closedBy", evidence, "closedAt", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now(), now())`,
    [newId(), kind, clip(title, 200), summary, personKey, threadKey, signalId, taskId, closedBy, evidence ? clip(evidence, 300) : null],
  );
}

export async function closeTask(t, { by, note = '', ledger = true }) {
  const row = await one(
    `WITH old AS (SELECT id, status FROM "JarvisTask" WHERE id = $1 AND status <> 'done' FOR UPDATE)
     UPDATE "JarvisTask" t SET status = 'done', "completedAt" = now(), "closedBy" = $2, "closeNote" = $3, "updatedAt" = now()
     FROM old WHERE t.id = old.id RETURNING t.id, t.title, t."threadKey", old.status AS "prevStatus"`,
    [t.id, by, clip(note, 300)],
  );
  if (!row) return null;
  const undo = await loadUndo();
  undo.prev[row.id] = row.prevStatus;
  await saveUndo(undo);
  if (ledger) await writeLedger({ kind: 'task', title: row.title, summary: 'Task closed', threadKey: row.threadKey, taskId: row.id, closedBy: by, evidence: note });
  return row;
}

// Closes (or expires) a signal. Linked tasks are closed too unless closeTasks is false.
export async function closeSignal(s, { by, resolution = '', status = 'resolved', closeTasks = true, taskBy = null }) {
  const closed = { prevStatus: s.status, by, at: new Date().toISOString(), taskIds: [] };
  const row = await one(
    `UPDATE "JarvisSignal" SET status = $2, "resolvedAt" = now(), "resolvedBy" = $3, resolution = $4,
       result = (CASE WHEN jsonb_typeof(result) = 'object' THEN result ELSE '{}'::jsonb END) || $5::jsonb, "updatedAt" = now()
     WHERE id = $1 AND status = ANY($6) RETURNING *`,
    [s.id, status, by, clip(resolution, 300), JSON.stringify({ closed }), OPEN_STATUSES.concat(status === 'expired' ? [] : ['applied'])],
  );
  if (!row) return null;
  const taskIds = [];
  if (closeTasks) {
    const tasks = await q(`SELECT id, title FROM "JarvisTask" WHERE status <> 'done' AND recurrence IS NULL AND (id = $1 OR "sourceSignalId" = $2)`, [row.result?.taskId || '', row.id]);
    for (const t of tasks) {
      if (await closeTask(t, { by: taskBy || by, note: resolution, ledger: false })) taskIds.push(t.id);
    }
    if (taskIds.length) {
      closed.taskIds = taskIds;
      await q(`UPDATE "JarvisSignal" SET result = result || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ closed })]);
    }
  }
  if (['reply', 'task', 'followup'].includes(row.kind) && row.personKey) {
    await q(`UPDATE "JarvisPerson" SET "openLoops" = GREATEST("openLoops" - 1, 0), "updatedAt" = now() WHERE key = $1`, [String(row.personKey).toLowerCase()]);
  }
  await writeLedger({
    kind: 'signal',
    title: row.title,
    summary: row.detail ? clip(row.detail, 200) : null,
    personKey: row.personKey,
    threadKey: row.threadKey,
    signalId: row.id,
    taskId: taskIds[0] || null,
    closedBy: by,
    evidence: resolution,
  });
  return { signal: row, taskIds };
}

// Undo a close: the signal returns to the status it had, its tasks to "todo", the ledger row goes.
export async function reopenSignal(signalId) {
  const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [signalId]);
  if (!s || !['resolved', 'expired'].includes(s.status)) return false;
  const closed = s.result?.closed || {};
  const back = OPEN_STATUSES.includes(closed.prevStatus) || closed.prevStatus === 'applied' ? closed.prevStatus : 'new';
  for (const id of closed.taskIds || []) await reopenTask(id, { quiet: true });
  await q(
    `UPDATE "JarvisSignal" SET status = $2, "resolvedAt" = NULL, "resolvedBy" = NULL, resolution = NULL,
       result = (CASE WHEN jsonb_typeof(result) = 'object' THEN result ELSE '{}'::jsonb END) - 'closed', "updatedAt" = now() WHERE id = $1`,
    [s.id, back],
  );
  await q(`DELETE FROM "JarvisLedger" WHERE "signalId" = $1`, [s.id]);
  if (['reply', 'task', 'followup'].includes(s.kind) && s.personKey) {
    await q(`UPDATE "JarvisPerson" SET "openLoops" = "openLoops" + 1 WHERE key = $1`, [String(s.personKey).toLowerCase()]);
  }
  await markReopened('signal', s.id);
  return true;
}

async function markReopened(type, id) {
  const undo = await loadUndo();
  undo.reopened[`${type}:${id}`] = new Date().toISOString();
  await saveUndo(undo);
}

export async function reopenTask(taskId, { quiet = false } = {}) {
  const undo = await loadUndo();
  const back = ['todo', 'doing'].includes(undo.prev[taskId]) ? undo.prev[taskId] : 'todo';
  const row = await one(
    `UPDATE "JarvisTask" SET status = $2, "completedAt" = NULL, "closedBy" = NULL, "closeNote" = NULL, "updatedAt" = now()
     WHERE id = $1 AND status = 'done' AND "closedBy" IN ('reply','reconcile','cleanup','expired') RETURNING id`,
    [taskId, back],
  );
  if (row) {
    delete undo.prev[taskId];
    undo.reopened[`task:${taskId}`] = new Date().toISOString();
    await saveUndo(undo);
    if (!quiet) await q(`DELETE FROM "JarvisLedger" WHERE "taskId" = $1 AND kind = 'task'`, [taskId]);
  }
  return !!row;
}

// ---------- evidence gathering ----------

// Until the owner approves the one-time clean-up card, nothing created before the card is
// closed or expired by Jarvis. Dismissed, failed or undone cards leave the gate shut.
export async function cleanupGate() {
  const g = await getSetting(CLEANUP_KEY, null);
  if (!g) return { blocked: true };
  if (g.approvedAt) return { cutoff: null };
  return { cutoff: new Date(g.at) };
}

// Timestamps are stored without a zone (UTC); an ISO string with an explicit cast avoids the
// driver's local-time formatting of a Date.
export const cutoffParam = (cutoff) => (cutoff ? new Date(cutoff).toISOString() : null);
export const CUTOFF_SQL = (col, n) => `($${n}::text IS NULL OR ${col} > (($${n}::text)::timestamptz AT TIME ZONE current_setting('TimeZone')))`;

async function openSignalRows(cutoff) {
  return q(
    `SELECT id, kind, title, detail, status, "threadKey", "personKey", "inboundIds", "createdAt", "updatedAt" FROM "JarvisSignal"
     WHERE status = ANY($1) AND kind NOT IN ('plan') AND COALESCE(action->>'type','') <> 'cleanup' AND ${CUTOFF_SQL('"createdAt"', 2)}
     ORDER BY "createdAt" DESC LIMIT ${ROW_LIMIT}`,
    [['new', 'pushed', 'snoozed'], cutoffParam(cutoff)],
  );
}

// Recurring tasks are left alone: completing one is what spawns the next occurrence.
async function openTaskRows(cutoff) {
  return q(
    `SELECT id, title, priority, status, "threadKey", "createdAt", "updatedAt" FROM "JarvisTask"
     WHERE status <> 'done' AND recurrence IS NULL AND ${CUTOFF_SQL('"createdAt"', 1)} ORDER BY "createdAt" DESC LIMIT ${ROW_LIMIT}`,
    [cutoffParam(cutoff)],
  );
}

async function withSince(signals) {
  const ids = [...new Set(signals.flatMap((s) => (Array.isArray(s.inboundIds) ? s.inboundIds : [])))];
  const times = new Map();
  const dirs = new Map();
  if (ids.length) {
    for (const r of await q(`SELECT id, "occurredAt", direction FROM "JarvisInbound" WHERE id = ANY($1)`, [ids])) {
      times.set(r.id, new Date(r.occurredAt).getTime());
      dirs.set(r.id, r.direction);
    }
  }
  return signals.map((s) => {
    const own = Array.isArray(s.inboundIds) ? s.inboundIds : [];
    const t = own.map((i) => times.get(i)).filter(Boolean);
    // A follow-up that rose from his own outgoing message is a promise of his, not someone's question.
    return { ...s, since: t.length ? new Date(Math.max(...t)) : s.createdAt, ownPromise: s.kind === 'followup' && own.some((i) => dirs.get(i) === 'out') };
  });
}

async function deterministicPass(signals, undo, { days = 30 } = {}) {
  const candidates = await withSince(signals.filter((s) => ['reply', 'followup'].includes(s.kind) && s.threadKey));
  if (!candidates.length) return [];
  const keys = [...new Set(candidates.map((s) => s.threadKey))];
  const outgoing = await q(
    `SELECT "threadKey", "occurredAt", left(body, 400) AS body FROM "JarvisInbound" WHERE direction = 'out' AND "threadKey" = ANY($1) AND "occurredAt" > now() - ($2 || ' days')::interval`,
    [keys, String(days)],
  );
  return selectDeterministicCloses(candidates, outgoing, { reopenedAt: (s) => reopenedAtOf(undo, 'signal', s.id) });
}

async function evidenceMessages({ sinceHours, limit = 80, signals = [] }) {
  const out = await q(
    `SELECT "threadKey", "occurredAt", body, "chatName", subject FROM "JarvisInbound" WHERE direction = 'out' AND "occurredAt" > now() - ($1 || ' hours')::interval ORDER BY "occurredAt" DESC LIMIT $2`,
    [String(sinceHours), limit],
  );
  const askers = new Map();
  for (const s of signals) if (s.threadKey) (askers.get(s.threadKey) || askers.set(s.threadKey, new Set()).get(s.threadKey)).add(String(s.personKey || '').toLowerCase());
  let others = [];
  if (askers.size) {
    const rows = await q(
      `SELECT "threadKey", "occurredAt", body, sender, "senderName" FROM "JarvisInbound" WHERE direction = 'in' AND "threadKey" = ANY($1) AND "occurredAt" > now() - ($2 || ' hours')::interval ORDER BY "occurredAt" DESC LIMIT $3`,
      [[...askers.keys()], String(sinceHours), limit],
    );
    // Someone other than the person who raised the item answering in the same thread.
    others = rows.filter((m) => !askers.get(m.threadKey).has(String(m.sender || '').toLowerCase()));
  }
  const fmt = (m, who) => `(${m.threadKey || 'no thread'}) ${new Date(m.occurredAt).toISOString().slice(0, 16)} ${who}: ${clip(m.body, 400)}`;
  const all = [...out.map((m) => ({ m, who: isAutoMessage(m) ? 'a Hostfully automated message (not him)' : 'YOU' })), ...others.map((m) => ({ m, who: `${m.senderName || m.sender} (another party)` }))].slice(0, limit * 2);
  return { lines: all.map((x) => fmt(x.m, x.who)), newestAt: all.reduce((n, x) => Math.max(n, new Date(x.m.occurredAt).getTime()), 0) };
}

const modelAvailable = () => !!(config.anthropicKey || globalThis.__jarvisFakeStructured);

// Asks the model which of these items the messages show as done. Accepts only offered ids.
export async function modelClose(items, messages) {
  if (!items.length || !messages.length) return [];
  const offered = items.slice(0, MODEL_CAP);
  const user = `Open items (id | type | kind | title | detail | thread | created):\n${offered
    .map((i) => `- ${i.id} | ${i.type} | ${i.kind || ''} | ${clip(i.title, 120)} | ${clip(i.detail || '', 160)} | ${i.threadKey || ''} | ${new Date(i.createdAt).toISOString().slice(0, 10)}`)
    .join('\n')}\n\nRecent messages:\n${messages.join('\n')}`;
  const result = await structured({ model: config.triageModel, system: CLOSE_RULES, user, schema: CLOSE_SCHEMA, effort: 'medium' });
  return acceptCloses(result, offered);
}

function asItems(signals, tasks) {
  return [
    ...signals.map((s) => ({ id: s.id, type: 'signal', kind: s.kind, title: s.title, detail: s.detail, threadKey: s.threadKey, createdAt: s.createdAt })),
    ...tasks.map((t) => ({ id: t.id, type: 'task', kind: t.priority, title: t.title, detail: '', threadKey: t.threadKey, createdAt: t.createdAt })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---------- the reconcile pass ----------

export async function reconcileOnce({ sinceHours = 24, model = true, force = false } = {}) {
  const gate = force ? { cutoff: null } : await cleanupGate();
  if (gate.blocked) return { skipped: 'awaiting the one-time clean-up proposal' };
  const summary = { deterministic: 0, model: 0 };
  const undo = await loadUndo();

  const signals = await openSignalRows(gate.cutoff);
  for (const { signal, outgoing } of await deterministicPass(signals, undo)) {
    if (await closeSignal(signal, { by: 'reply', resolution: clip(outgoing.body, 200) })) summary.deterministic += 1;
  }

  if (model && modelAvailable()) {
    // The model pass only runs when he has written something since the last one.
    const latest = await one(`SELECT max("occurredAt") AS at FROM "JarvisInbound" WHERE direction = 'out' AND body NOT LIKE '[auto] %'`);
    const outAt = latest?.at ? new Date(latest.at).getTime() : 0;
    const cursor = (await getSetting(MODEL_CURSOR_KEY, null)) || {};
    if (!force && (!outAt || outAt <= Number(cursor.outAt || 0))) {
      summary.modelSkipped = 'no new outgoing message';
      return summary;
    }
    const sigs = await openSignalRows(gate.cutoff);
    const tasks = await openTaskRows(gate.cutoff);
    const evidence = await evidenceMessages({ sinceHours, signals: sigs });
    const items = asItems(sigs, tasks).filter(notOverridden(undo, evidence.newestAt)).slice(0, MODEL_CAP);
    let failed = false;
    const accepted = await modelClose(items, evidence.lines).catch((e) => {
      console.error('[reconcile] model close failed:', e.message);
      failed = true;
      return [];
    });
    for (const c of accepted) {
      if (c.type === 'signal') {
        const s = sigs.find((x) => x.id === c.id);
        if (s && (await closeSignal(s, { by: 'reconcile', resolution: c.evidence }))) summary.model += 1;
      } else {
        const t = tasks.find((x) => x.id === c.id);
        if (t && (await closeTask(t, { by: 'reconcile', note: c.evidence }))) summary.model += 1;
      }
    }
    if (!failed) await setSetting(MODEL_CURSOR_KEY, { outAt, at: new Date().toISOString() });
  }
  return summary;
}

// Triage calls this after it stored something he wrote. At most once per 5 minutes; the
// 10-minute loop catches anything skipped.
let lastTriageReconcile = 0;
export async function reconcileFromTriage({ now = Date.now() } = {}) {
  if (!v3State.ready) return { skipped: 'v3 not ready' };
  if (now - lastTriageReconcile < TRIAGE_DEBOUNCE_MS) return { skipped: 'debounced' };
  lastTriageReconcile = now;
  return reconcileOnce({ sinceHours: 6 });
}
export const _resetTriageDebounce = () => { lastTriageReconcile = 0; };

// ---------- expiry ----------

// Respects the clean-up gate (nothing from before the card is touched until the owner approves
// it), never expires a signal that is snoozed into the future or that the owner reopened, and
// judges a reply's staleness by the latest message on its thread, not by when the row changed.
export async function expireSignals() {
  const gate = await cleanupGate();
  if (gate.blocked) return 0;
  const undo = await loadUndo();
  const cut = cutoffParam(gate.cutoff);
  let n = 0;
  const past = await q(
    `SELECT id, status FROM "JarvisSignal"
     WHERE status = ANY($1) AND "expiresAt" IS NOT NULL AND "expiresAt" < now() AND kind <> 'plan'
       AND ("snoozeUntil" IS NULL OR "snoozeUntil" <= now()) AND ${CUTOFF_SQL('"createdAt"', 2)} LIMIT ${ROW_LIMIT}`,
    [['new', 'pushed', 'snoozed'], cut],
  );
  for (const s of past) {
    if (reopenedAtOf(undo, 'signal', s.id)) continue;
    if (await closeSignal(s, { by: 'expired', status: 'expired', resolution: 'It passed its time', closeTasks: false })) n += 1;
  }
  const stale = await q(
    `SELECT s.id, s.status,
       GREATEST(s."createdAt", COALESCE((SELECT max(i."occurredAt") FROM "JarvisInbound" i WHERE i."threadKey" = s."threadKey" AND i.direction = 'in'), s."createdAt")) AS "lastActivity"
     FROM "JarvisSignal" s
     WHERE s.status = ANY($1) AND s.kind = 'reply' AND (s."snoozeUntil" IS NULL OR s."snoozeUntil" <= now()) AND ${CUTOFF_SQL('s."createdAt"', 2)}
     LIMIT ${ROW_LIMIT}`,
    [['new', 'pushed', 'snoozed'], cut],
  );
  const limit = Date.now() - 5 * 864e5;
  for (const s of stale) {
    const reopened = reopenedAtOf(undo, 'signal', s.id);
    const last = Math.max(new Date(s.lastActivity).getTime(), reopened ? new Date(reopened).getTime() : 0);
    if (last >= limit) continue;
    if (await closeSignal(s, { by: 'expired', status: 'expired', resolution: 'No activity for 5 days', closeTasks: false })) n += 1;
  }
  return n;
}

// Two quiet nudges about tasks nobody is touching, both through the signal table:
//  - overdue 7 days with no activity: one "still relevant?" card per task, ever;
//  - open with no activity for 3 days: "Pick this up?", for overdue tasks or ones touched in the last
//    14 days, once per 3 days, twice per task until it changes, 5 a day at most.
// Neither deletes anything. threadKey 'task:<id>' is what keeps a task from being nudged twice.
async function insertTaskNudge(t, { title, detail, why, score }) {
  const id = newId();
  await q(
    `INSERT INTO "JarvisSignal" (id, kind, title, detail, why, score, source, "threadKey", autonomy, status, "updatedAt")
     VALUES ($1,'nudge',$2,$3,$4,$5,'planner',$6,'ask','new', now())`,
    [id, clip(title, 140), detail, why, score, `task:${t.id}`],
  );
  return id;
}

const STALLED_WHY = 'A task with no activity for 3 days';

export async function nudgeStaleTasks() {
  const overdue = await q(
    `SELECT t.id, t.title FROM "JarvisTask" t
     WHERE t.status <> 'done' AND t."dueDate" < now() - interval '7 days' AND t."updatedAt" < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM "JarvisSignal" s WHERE s.kind = 'nudge' AND s."threadKey" = 'task:' || t.id)
     LIMIT 10`,
  );
  for (const t of overdue) {
    await insertTaskNudge(t, { title: `Still relevant? ${t.title}`, detail: 'This task is more than a week overdue with no activity. Mark it done, move it, or leave it.', why: 'An overdue task nobody has touched', score: 50 });
  }
  return overdue.length + (await nudgeStalledTasks());
}

export async function nudgeStalledTasks({ now = Date.now() } = {}) {
  const tasks = await q(
    `SELECT id, title, status, "updatedAt", "dueDate" FROM "JarvisTask"
     WHERE status <> 'done' AND "updatedAt" < now() - interval '3 days' AND ("dueDate" IS NULL OR "dueDate" >= now() - interval '7 days')
     ORDER BY "updatedAt" LIMIT 100`,
  );
  if (!tasks.length) return 0;
  const nudges = await q(`SELECT "threadKey", status, "createdAt" FROM "JarvisSignal" WHERE kind = 'nudge' AND why = $1 AND "threadKey" = ANY($2)`, [STALLED_WHY, tasks.map((t) => `task:${t.id}`)]);
  const today = await one(`SELECT count(*)::int AS n FROM "JarvisSignal" WHERE kind = 'nudge' AND why = $1 AND "createdAt" > now() - interval '24 hours'`, [STALLED_WHY]);
  const picked = selectStalledTasks(tasks, nudges, { now, alreadyToday: today?.n || 0 });
  for (const t of picked) {
    const days = Math.floor((now - new Date(t.updatedAt).getTime()) / 864e5);
    const id = await insertTaskNudge(t, { title: `Pick this up? ${t.title}`, detail: `No activity on this task for ${days} days. Do it, move it, or let it go.`, why: STALLED_WHY, score: 55 });
    await pushSignal(id).catch((e) => console.error('[reconcile] nudge push', e.message));
  }
  return picked.length;
}

// ---------- one-time clean-up proposal ----------

export async function buildCleanupProposal({ model = true } = {}) {
  const sigs = await openSignalRows(null);
  const tasks = await openTaskRows(null);
  const undo = await loadUndo();
  const close = [];
  const taken = new Set();
  const take = (type, id, title, evidence) => {
    if (taken.has(`${type}:${id}`)) return;
    taken.add(`${type}:${id}`);
    close.push({ id, type, title, evidence });
  };

  for (const { signal, outgoing } of await deterministicPass(sigs, undo, { days: 60 })) take('signal', signal.id, signal.title, `You replied: ${clip(outgoing.body, 140)}`);

  if (model && modelAvailable()) {
    const evidence = await evidenceMessages({ sinceHours: 24 * 21, limit: 120, signals: sigs });
    const items = asItems(sigs, tasks).filter(notOverridden(undo, evidence.newestAt));
    for (let i = 0; i < items.length; i += MODEL_CAP) {
      const accepted = await modelClose(items.slice(i, i + MODEL_CAP), evidence.lines);
      for (const c of accepted) {
        const it = items.find((x) => x.id === c.id && x.type === c.type);
        if (it) take(c.type, c.id, it.title, c.evidence);
      }
    }
  }

  const remaining = tasks.filter((t) => !taken.has(`task:${t.id}`));
  const merge = findDuplicateGroups(remaining);
  return { close, merge };
}

export async function createCleanupCard({ force = false } = {}) {
  if (!force && (await getSetting(CLEANUP_KEY, null))) return null;
  const proposal = await buildCleanupProposal({ model: modelAvailable() });
  const at = new Date().toISOString();
  const mergeCount = proposal.merge.reduce((n, g) => n + g.drop.length, 0);
  if (!proposal.close.length && !mergeCount) {
    // Nothing to approve, so nothing is held back.
    await setSetting(CLEANUP_KEY, { at, cardId: null, approvedAt: at });
    return null;
  }
  const id = newId();
  const lines = [
    ...proposal.close.slice(0, 25).map((c) => `Close: ${clip(c.title, 80)} (${clip(c.evidence, 90)})`),
    ...proposal.merge.slice(0, 15).map((g) => `Merge ${g.drop.length} into: ${clip(g.keep.title, 80)}`),
  ];
  await q(
    `INSERT INTO "JarvisSignal" (id, kind, title, detail, why, score, source, action, autonomy, status, "updatedAt")
     VALUES ($1,'plan',$2,$3,'Nothing is closed until you tap Do it. Undo works afterwards.', 75, 'reconcile', $4, 'ask', 'new', now())`,
    [
      id,
      `Clean-up: I can close ${proposal.close.length} items you've already done and merge ${mergeCount} duplicates`,
      lines.join('\n'),
      JSON.stringify({ type: 'cleanup', payload: proposal }),
    ],
  );
  await setSetting(CLEANUP_KEY, { at, cardId: id, approvedAt: null });
  await pushSignal(id).catch((e) => console.error('[reconcile] push', e.message));
  return { id, proposal };
}

// Every 30 minutes: make the first card, and rebuild a fresh one 3 days after the owner
// dismissed (or undid, or failed) the last, so older items do not stay protected forever.
export async function cleanupTick({ now = Date.now() } = {}) {
  const g = await getSetting(CLEANUP_KEY, null);
  if (!g) return createCleanupCard();
  if (g.approvedAt || !g.cardId) return null;
  const card = await one(`SELECT status, "decidedAt", "updatedAt" FROM "JarvisSignal" WHERE id = $1`, [g.cardId]);
  if (card?.status === 'applied') {
    await setSetting(CLEANUP_KEY, { ...g, approvedAt: new Date(card.decidedAt || now).toISOString() });
    return null;
  }
  if (card && !['dismissed', 'failed', 'undone'].includes(card.status)) return null;
  const decidedAt = card ? new Date(card.decidedAt || card.updatedAt || g.at).getTime() : new Date(g.at).getTime();
  if (now - decidedAt < REDO_AFTER_DISMISS_MS) return null;
  return createCleanupCard({ force: true });
}

// Runs when the owner approves the clean-up card. Only items still open, and not touched since
// the card was made, are closed.
export async function applyCleanup(payload, { signalId = null } = {}) {
  const done = { signals: [], tasks: [], merged: [], skipped: [] };
  const card = signalId ? await one(`SELECT "createdAt" FROM "JarvisSignal" WHERE id = $1`, [signalId]) : null;
  const madeAt = card ? new Date(card.createdAt).getTime() : null;
  const changedSince = (row) => madeAt != null && new Date(row.updatedAt).getTime() > madeAt;
  for (const c of payload?.close || []) {
    if (c.type === 'signal') {
      const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [c.id]);
      if (s && changedSince(s)) {
        done.skipped.push(c.id);
        continue;
      }
      if (s && (await closeSignal(s, { by: 'reconcile', resolution: c.evidence, taskBy: 'cleanup' }))) done.signals.push(c.id);
    } else {
      const t = await one(`SELECT id, title, "updatedAt", recurrence FROM "JarvisTask" WHERE id = $1`, [c.id]);
      if (t && (t.recurrence || changedSince(t))) {
        done.skipped.push(c.id);
        continue;
      }
      if (t && (await closeTask(t, { by: 'cleanup', note: c.evidence }))) done.tasks.push(c.id);
    }
  }
  for (const g of payload?.merge || []) {
    const keep = await one(`SELECT id, title FROM "JarvisTask" WHERE id = $1 AND status <> 'done'`, [g.keep.id]);
    if (!keep) continue;
    for (const d of g.drop) {
      const t = await one(`SELECT id, title, "updatedAt", recurrence FROM "JarvisTask" WHERE id = $1`, [d.id]);
      if (t && (t.recurrence || changedSince(t))) {
        done.skipped.push(d.id);
        continue;
      }
      if (t && (await closeTask(t, { by: 'cleanup', note: `Merged into: ${keep.title}`, ledger: false }))) {
        done.tasks.push(t.id);
        done.merged.push({ from: t.id, into: keep.id });
      }
    }
  }
  await writeLedger({
    kind: 'cleanup',
    title: `Clean-up: closed ${done.signals.length + done.tasks.length - done.merged.length}, merged ${done.merged.length}`,
    signalId,
    closedBy: 'cleanup',
  });
  // Only now is the gate open: an approved card that threw part way stays blocked.
  const g = await getSetting(CLEANUP_KEY, null);
  if (g && (!signalId || g.cardId === signalId)) await setSetting(CLEANUP_KEY, { ...g, approvedAt: new Date().toISOString() });
  return done;
}

export async function undoCleanup(done, { signalId = null } = {}) {
  for (const id of done?.signals || []) await reopenSignal(id);
  for (const id of done?.tasks || []) await reopenTask(id);
  // The gate shuts again; the reopened items are also individually protected.
  const g = await getSetting(CLEANUP_KEY, null);
  if (g && g.approvedAt && (!signalId || g.cardId === signalId)) await setSetting(CLEANUP_KEY, { ...g, approvedAt: null });
}
