import { q, one, newId } from './db.js';
import { claim, finish, fail, recoverStuck } from './jobs.js';
import { createEvent, deleteEvent } from './calendar.js';
import { listConnections, api } from './accounts.js';
import { sendGmail, gmailDraft } from './gmail.js';
import { sendOutlook, outlookDraft } from './outlook.js';
import { sendPush, mayInterrupt } from './push.js';
import { clip, tzOffsetMinutes } from './util.js';
import { titleSimilarity, DUPLICATE_THRESHOLD } from './pure.js';
import { sendHostfullyMessage } from './hostfully.js';
import { applyCleanup, undoCleanup, reopenSignal, reopenTask } from './reconcile.js';

export { titleSimilarity };

// Runs the jobs: applying an approved signal, undoing it, and direct requests from chat.
// Nothing here sends a message unless a person approved it (push button, signal page or chat).

let wa = null;
export function attachWhatsApp(instance) {
  wa = instance;
}

async function connById(id) {
  if (!id) return null;
  for (const p of ['google', 'microsoft']) {
    const found = (await listConnections(p)).find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}

// Creates a task unless an open one already covers the same thing (same thread, or a title
// at least DUPLICATE_THRESHOLD similar); then it links to that one instead.
export async function findOpenDuplicateTask({ title, threadKey }) {
  if (threadKey) {
    const same = await one(`SELECT id, title FROM "JarvisTask" WHERE status <> 'done' AND "threadKey" = $1 ORDER BY "createdAt" LIMIT 1`, [threadKey]);
    if (same) return same;
  }
  try {
    const best = await one(
      `SELECT id, title, extensions.similarity(lower(title), lower($1)) AS sim FROM "JarvisTask" WHERE status <> 'done' ORDER BY sim DESC LIMIT 1`,
      [title],
    );
    if (best && Number(best.sim) >= DUPLICATE_THRESHOLD) return best;
    // pg_trgm is character based and can miss reordered words; the word check below is cheap.
  } catch {
    // pg_trgm not installed here: fall through to the word-overlap check.
  }
  const open = await q(`SELECT id, title FROM "JarvisTask" WHERE status <> 'done' ORDER BY "createdAt" DESC LIMIT 400`);
  return open.find((t) => titleSimilarity(t.title, title) >= DUPLICATE_THRESHOLD) || null;
}

export async function createTask({ title, dueDate, priority = 'medium', projectId = null, sourceSignalId = null, threadKey = null }) {
  const dupe = await findOpenDuplicateTask({ title, threadKey });
  if (dupe) return { taskId: dupe.id, linked: true, duplicateOf: dupe.title };
  const id = newId();
  await q(
    `INSERT INTO "JarvisTask" (id, "projectId", title, status, priority, "dueDate", "sourceSignalId", "threadKey", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'todo', $4, $5, $6, $7, now(), now())`,
    [id, projectId, clip(title, 200), priority, dueDate ? new Date(dueDate) : null, sourceSignalId, threadKey],
  );
  return { taskId: id };
}

async function sendReply(p, mode = 'send') {
  const text = p.text;
  if (!text) throw new Error('nothing to send');
  if (p.channel === 'hostfully') {
    if (mode === 'draft') return { draft: true, note: 'Hostfully has no drafts; copy the text from Jarvis' };
    return sendHostfullyMessage({ threadKey: p.threadKey, text });
  }
  if (p.channel === 'whatsapp') {
    if (mode === 'draft') return { draft: true, note: 'WhatsApp has no drafts; copy the text from Jarvis' };
    if (!wa) throw new Error('WhatsApp is not running');
    const jid = String(p.threadKey || '').replace(/^wa:/, '');
    return wa.send(jid, text);
  }
  const conn = await connById(p.connectionId);
  if (!conn) throw new Error('that mailbox is no longer connected');
  if (p.channel === 'gmail') {
    const [, , msgId] = String(p.replyToExternalId || '').split(':');
    const threadId = String(p.threadKey || '').split(':')[2] || undefined;
    let inReplyTo;
    if (msgId) {
      const meta = await api(conn, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=Message-ID`).catch(() => null);
      inReplyTo = meta?.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value;
    }
    const args = { to: p.to, subject: p.subject, body: text, threadId, inReplyTo };
    return mode === 'draft' ? gmailDraft(conn, args) : sendGmail(conn, args);
  }
  if (p.channel === 'outlook') {
    // externalId is outlook:<mailbox>:<messageId>; a reply to shared mailbox mail goes out from it.
    const parts = String(p.replyToExternalId || '').split(':');
    const msgId = parts.slice(2).join(':');
    const args = { to: p.to, subject: p.subject, body: text, replyToMessageId: msgId || undefined, mailbox: parts[1] || undefined };
    return mode === 'draft' ? outlookDraft(conn, args) : sendOutlook(conn, args);
  }
  throw new Error(`unknown channel ${p.channel}`);
}

async function applySignal({ signalId, auto = false, text, mode = 'send', edits }) {
  const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [signalId]);
  if (!s) throw new Error('signal not found');
  if (['applied', 'dismissed', 'undone'].includes(s.status)) return { skipped: s.status };
  const action = s.action || {};
  const payload = { ...(action.payload || {}), ...(edits || {}) };
  if (text) payload.text = text;
  let result = {};
  if (action.type === 'calendar_event') result = { event: await createEvent(payload) };
  else if (action.type === 'create_task') result = await createTask({ ...payload, sourceSignalId: s.id, threadKey: s.threadKey || payload.threadKey || null });
  else if (action.type === 'cleanup') result = { cleanup: await applyCleanup(payload, { signalId: s.id }) };
  else if (action.type === 'send_reply') result = { sent: await sendReply(payload, mode), mode };
  else if (action.type === 'plan_blocks') result = { events: await blockPlan(payload) };
  await q(
    `UPDATE "JarvisSignal" SET status = 'applied', result = $2, "decidedAt" = now(), "updatedAt" = now(), action = $3 WHERE id = $1`,
    [s.id, JSON.stringify(result), JSON.stringify({ ...action, payload })],
  );
  // Tell the owner what was done on their behalf (with undo) when it was automatic and worth knowing.
  if (auto && action.type === 'calendar_event' && (await mayInterrupt(Math.max(s.score, 50))).ok) {
    await sendPush({
      title: `Added to your ${payload.purpose === 'work' ? 'Outlook' : 'Google'} calendar`,
      body: clip(`${payload.title}, ${new Date(payload.start).toLocaleString('en-GB', { timeZone: payload.tz || 'Asia/Kuwait', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Tap to undo or change.`, 230),
      url: `/jarvis/signals/${s.id}`,
      tag: `jarvis-auto-${s.id}`,
    });
    await q(`UPDATE "JarvisSignal" SET "pushedAt" = now() WHERE id = $1`, [s.id]);
  }
  return result;
}

// The morning plan's focus, admin and family blocks become calendar holds.
// Family and personal blocks go to the personal (Google) calendar, work blocks to Outlook.
async function blockPlan({ day, tz, blocks = [] }) {
  const out = [];
  const offset = tzOffsetMinutes(tz || 'Asia/Kuwait');
  const sign = offset >= 0 ? '+' : '-';
  const off = `${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  for (const b of blocks) {
    if (!/^\d{1,2}:\d{2}$/.test(b.start) || !/^\d{1,2}:\d{2}$/.test(b.end)) continue;
    const iso = (t) => `${day}T${t.padStart(5, '0')}:00${off}`;
    try {
      out.push(await createEvent({ purpose: b.kind === 'family' || b.kind === 'personal' ? 'personal' : 'work', title: b.kind === 'family' ? `Family time: ${b.title}` : b.title, start: iso(b.start), end: iso(b.end), tentative: false, tz }));
    } catch (e) {
      console.error('[jobs] plan block', e.message);
    }
  }
  return out;
}

async function undoSignal({ signalId }) {
  const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [signalId]);
  if (!s) return { skipped: true };
  // A signal closed by a reply, by reconcile or by expiry comes back to its earlier state.
  if (['resolved', 'expired'].includes(s.status)) return { reopened: await reopenSignal(s.id) };
  if (s.status !== 'applied') return { skipped: true };
  const r = s.result || {};
  if (r.cleanup) await undoCleanup(r.cleanup);
  if (r.event?.eventId) await deleteEvent(r.event);
  for (const ev of r.events || []) if (ev?.eventId) await deleteEvent(ev).catch(() => {});
  if (r.taskId && !r.linked) await q(`DELETE FROM "JarvisTask" WHERE id = $1`, [r.taskId]);
  if (r.sent) throw new Error('a sent message cannot be unsent');
  await q(`UPDATE "JarvisSignal" SET status = 'undone', "updatedAt" = now() WHERE id = $1`, [s.id]);
  return { undone: true };
}

const HANDLERS = {
  apply_signal: applySignal,
  undo_signal: undoSignal,
  undo_task_close: ({ taskId }) => reopenTask(taskId),
  calendar_event: (p) => createEvent(p),
  delete_event: (p) => deleteEvent(p),
  create_task: (p) => createTask(p),
  send_message: (p) => sendReply(p, p.mode || 'send'),
  whatsapp_logout: async () => {
    await wa?.logout();
    return { ok: true };
  },
};

export async function runJobs() {
  await recoverStuck();
  for (let i = 0; i < 10; i++) {
    const job = await claim();
    if (!job) return;
    const handler = HANDLERS[job.kind];
    if (!handler) {
      await fail(job.id, `unknown job kind ${job.kind}`);
      continue;
    }
    try {
      const result = await handler(job.payload || {});
      await finish(job.id, result);
    } catch (e) {
      console.error(`[jobs] ${job.kind} failed:`, e.message);
      const retry = /rate limited|ECONNRESET|ETIMEDOUT|fetch failed|5\d\d/.test(e.message);
      await fail(job.id, e.message, retry);
      if (job.kind === 'apply_signal' && !retry) {
        await q(`UPDATE "JarvisSignal" SET status = 'failed', result = $2, "updatedAt" = now() WHERE id = $1`, [job.payload.signalId, JSON.stringify({ error: e.message })]).catch(() => {});
      }
    }
  }
}
