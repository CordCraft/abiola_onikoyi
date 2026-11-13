import { config } from './config.js';
import { q, one, newId, getSetting, setSetting } from './db.js';
import { structured } from './llm.js';
import { clip } from './util.js';
import { pushSignal } from './push.js';
import { OPEN_STATUSES, selectDeterministicCloses, acceptCloses, findDuplicateGroups, selectStalledTasks, isAutoMessage } from './pure.js';

// Closes loops. An outgoing message on a thread closes the reply it answers; a model pass
// reads recent messages against the open signals and tasks; housekeeping expires what has
// stopped mattering. Every close writes a JarvisLedger row and can be undone.
// This module must not import executor.js or brain.js (they import it).

const CLEANUP_KEY = 'v3_cleanup_proposed';
const MODEL_CAP = 150;

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
    `UPDATE "JarvisTask" SET status = 'done', "completedAt" = now(), "closedBy" = $2, "closeNote" = $3, "updatedAt" = now()
     WHERE id = $1 AND status <> 'done' RETURNING id, title, "threadKey"`,
    [t.id, by, clip(note, 300)],
  );
  if (!row) return null;
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
    const tasks = await q(`SELECT id, title FROM "JarvisTask" WHERE status <> 'done' AND (id = $1 OR "sourceSignalId" = $2)`, [row.result?.taskId || '', row.id]);
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
  return true;
}

export async function reopenTask(taskId, { quiet = false } = {}) {
  const row = await one(
    `UPDATE "JarvisTask" SET status = 'todo', "completedAt" = NULL, "closedBy" = NULL, "closeNote" = NULL, "updatedAt" = now()
     WHERE id = $1 AND status = 'done' AND "closedBy" IN ('reply','reconcile','cleanup','expired') RETURNING id`,
    [taskId],
  );
  if (row && !quiet) await q(`DELETE FROM "JarvisLedger" WHERE "taskId" = $1 AND kind = 'task'`, [taskId]);
  return !!row;
}

// ---------- evidence gathering ----------

async function cleanupCutoff() {
  // Until the one-time clean-up card is decided, older items are left for the owner to approve.
  const g = await getSetting(CLEANUP_KEY, null);
  if (!g) return { blocked: true };
  if (!g.cardId) return { cutoff: null };
  const card = await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [g.cardId]);
  if (card && OPEN_STATUSES.includes(card.status)) return { cutoff: new Date(g.at) };
  return { cutoff: null };
}

async function openSignalRows(cutoff) {
  return q(
    `SELECT * FROM "JarvisSignal" WHERE status = ANY($1) AND kind NOT IN ('plan') AND COALESCE(action->>'type','') <> 'cleanup'
       AND ($2::timestamp IS NULL OR "createdAt" > $2) ORDER BY "createdAt" DESC`,
    [['new', 'pushed', 'snoozed'], cutoff],
  );
}

async function openTaskRows(cutoff) {
  return q(`SELECT * FROM "JarvisTask" WHERE status <> 'done' AND ($1::timestamp IS NULL OR "createdAt" > $1) ORDER BY "createdAt" DESC`, [cutoff]);
}

async function withSince(signals) {
  const ids = [...new Set(signals.flatMap((s) => (Array.isArray(s.inboundIds) ? s.inboundIds : [])))];
  const times = new Map();
  if (ids.length) for (const r of await q(`SELECT id, "occurredAt" FROM "JarvisInbound" WHERE id = ANY($1)`, [ids])) times.set(r.id, new Date(r.occurredAt).getTime());
  return signals.map((s) => {
    const t = (Array.isArray(s.inboundIds) ? s.inboundIds : []).map((i) => times.get(i)).filter(Boolean);
    return { ...s, since: t.length ? new Date(Math.max(...t)) : s.createdAt };
  });
}

async function deterministicPass(signals, { days = 30 } = {}) {
  const candidates = await withSince(signals.filter((s) => ['reply', 'followup'].includes(s.kind) && s.threadKey));
  if (!candidates.length) return [];
  const keys = [...new Set(candidates.map((s) => s.threadKey))];
  const outgoing = await q(
    `SELECT "threadKey", "occurredAt", body FROM "JarvisInbound" WHERE direction = 'out' AND "threadKey" = ANY($1) AND "occurredAt" > now() - ($2 || ' days')::interval`,
    [keys, String(days)],
  );
  return selectDeterministicCloses(candidates, outgoing);
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
  return [...out.map((m) => fmt(m, isAutoMessage(m) ? 'a Hostfully automated message (not him)' : 'YOU')), ...others.map((m) => fmt(m, `${m.senderName || m.sender} (another party)`))]
    .slice(0, limit * 2);
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
  const gate = force ? { cutoff: null } : await cleanupCutoff();
  if (gate.blocked) return { skipped: 'awaiting the one-time clean-up proposal' };
  const summary = { deterministic: 0, model: 0 };

  const signals = await openSignalRows(gate.cutoff);
  for (const { signal, outgoing } of await deterministicPass(signals)) {
    if (await closeSignal(signal, { by: 'reply', resolution: clip(outgoing.body, 200) })) summary.deterministic += 1;
  }

  if (model && modelAvailable()) {
    const sigs = await openSignalRows(gate.cutoff);
    const tasks = await openTaskRows(gate.cutoff);
    const items = asItems(sigs, tasks).slice(0, MODEL_CAP);
    const messages = await evidenceMessages({ sinceHours, signals: sigs });
    const accepted = await modelClose(items, messages).catch((e) => {
      console.error('[reconcile] model close failed:', e.message);
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
  }
  return summary;
}

// ---------- expiry ----------

export async function expireSignals() {
  let n = 0;
  const past = await q(
    `SELECT * FROM "JarvisSignal" WHERE status = ANY($1) AND "expiresAt" IS NOT NULL AND "expiresAt" < now() AND kind <> 'plan'`,
    [['new', 'pushed', 'snoozed']],
  );
  for (const s of past) if (await closeSignal(s, { by: 'expired', status: 'expired', resolution: 'It passed its time', closeTasks: false })) n += 1;
  const stale = await q(
    `SELECT * FROM "JarvisSignal" WHERE status = ANY($1) AND kind = 'reply' AND "updatedAt" < now() - interval '5 days'`,
    [['new', 'pushed', 'snoozed']],
  );
  for (const s of stale) if (await closeSignal(s, { by: 'expired', status: 'expired', resolution: 'No activity for 5 days', closeTasks: false })) n += 1;
  return n;
}

// Two quiet nudges about tasks nobody is touching, both through the signal table:
//  - overdue 7 days with no activity: one "still relevant?" card per task, ever;
//  - open with no activity for 3 days: "Pick this up?", once per task per 3 days, 5 a day at most.
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
    `SELECT id, title, status, "updatedAt" FROM "JarvisTask"
     WHERE status <> 'done' AND "updatedAt" < now() - interval '3 days' AND ("dueDate" IS NULL OR "dueDate" >= now() - interval '7 days')
     ORDER BY "updatedAt" LIMIT 100`,
  );
  if (!tasks.length) return 0;
  const nudges = await q(`SELECT "threadKey", status, "createdAt" FROM "JarvisSignal" WHERE kind = 'nudge' AND "threadKey" LIKE 'task:%' AND "createdAt" > now() - interval '3 days'`);
  const today = await one(`SELECT count(*)::int AS n FROM "JarvisSignal" WHERE kind = 'nudge' AND why = 'A task with no activity for 3 days' AND "createdAt" > now() - interval '24 hours'`);
  const picked = selectStalledTasks(tasks, nudges, { now, alreadyToday: today?.n || 0 });
  for (const t of picked) {
    const days = Math.floor((now - new Date(t.updatedAt).getTime()) / 864e5);
    const id = await insertTaskNudge(t, { title: `Pick this up? ${t.title}`, detail: `No activity on this task for ${days} days. Do it, move it, or let it go.`, why: 'A task with no activity for 3 days', score: 55 });
    await pushSignal(id).catch((e) => console.error('[reconcile] nudge push', e.message));
  }
  return picked.length;
}

// ---------- one-time clean-up proposal ----------

export async function buildCleanupProposal({ model = true } = {}) {
  const sigs = await openSignalRows(null);
  const tasks = await openTaskRows(null);
  const close = [];
  const taken = new Set();
  const take = (type, id, title, evidence) => {
    if (taken.has(`${type}:${id}`)) return;
    taken.add(`${type}:${id}`);
    close.push({ id, type, title, evidence });
  };

  for (const { signal, outgoing } of await deterministicPass(sigs, { days: 60 })) take('signal', signal.id, signal.title, `You replied: ${clip(outgoing.body, 140)}`);

  if (model && modelAvailable()) {
    const items = asItems(sigs, tasks);
    const messages = await evidenceMessages({ sinceHours: 24 * 21, limit: 120, signals: sigs });
    for (let i = 0; i < items.length; i += MODEL_CAP) {
      const accepted = await modelClose(items.slice(i, i + MODEL_CAP), messages);
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
    await setSetting(CLEANUP_KEY, { at, cardId: null });
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
  await setSetting(CLEANUP_KEY, { at, cardId: id });
  await pushSignal(id).catch((e) => console.error('[reconcile] push', e.message));
  return { id, proposal };
}

// Runs when the owner approves the clean-up card. Only items still open are touched.
export async function applyCleanup(payload, { signalId = null } = {}) {
  const done = { signals: [], tasks: [], merged: [] };
  for (const c of payload?.close || []) {
    if (c.type === 'signal') {
      const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [c.id]);
      if (s && (await closeSignal(s, { by: 'reconcile', resolution: c.evidence, taskBy: 'cleanup' }))) done.signals.push(c.id);
    } else {
      const t = await one(`SELECT id, title FROM "JarvisTask" WHERE id = $1`, [c.id]);
      if (t && (await closeTask(t, { by: 'cleanup', note: c.evidence }))) done.tasks.push(c.id);
    }
  }
  for (const g of payload?.merge || []) {
    const keep = await one(`SELECT id, title FROM "JarvisTask" WHERE id = $1 AND status <> 'done'`, [g.keep.id]);
    if (!keep) continue;
    for (const d of g.drop) {
      const t = await one(`SELECT id, title FROM "JarvisTask" WHERE id = $1`, [d.id]);
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
  return done;
}

export async function undoCleanup(done) {
  for (const id of done?.signals || []) await reopenSignal(id);
  for (const id of done?.tasks || []) await reopenTask(id);
}
