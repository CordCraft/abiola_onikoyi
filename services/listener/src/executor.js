import { q, one, newId } from './db.js';
import { claim, finish, fail, recoverStuck } from './jobs.js';
import { createEvent, deleteEvent } from './calendar.js';
import { listConnections, api } from './accounts.js';
import { sendGmail, gmailDraft } from './gmail.js';
import { sendOutlook, outlookDraft } from './outlook.js';
import { sendPush, mayInterrupt } from './push.js';
import { clip, tzOffsetMinutes } from './util.js';

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

async function createTask({ title, dueDate, priority = 'medium', projectId = null }) {
  const id = newId();
  await q(
    `INSERT INTO "JarvisTask" (id, "projectId", title, status, priority, "dueDate", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'todo', $4, $5, now(), now())`,
    [id, projectId, clip(title, 200), priority, dueDate ? new Date(dueDate) : null],
  );
  return { taskId: id };
}

async function sendReply(p, mode = 'send') {
  const text = p.text;
  if (!text) throw new Error('nothing to send');
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
    const msgId = String(p.replyToExternalId || '').split(':').slice(2).join(':');
    const args = { to: p.to, subject: p.subject, body: text, replyToMessageId: msgId || undefined };
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
  else if (action.type === 'create_task') result = await createTask(payload);
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
  if (!s || s.status !== 'applied') return { skipped: true };
  const r = s.result || {};
  if (r.event?.eventId) await deleteEvent(r.event);
  for (const ev of r.events || []) if (ev?.eventId) await deleteEvent(ev).catch(() => {});
  if (r.taskId) await q(`DELETE FROM "JarvisTask" WHERE id = $1`, [r.taskId]);
  if (r.sent) throw new Error('a sent message cannot be unsent');
  await q(`UPDATE "JarvisSignal" SET status = 'undone', "updatedAt" = now() WHERE id = $1`, [s.id]);
  return { undone: true };
}

const HANDLERS = {
  apply_signal: applySignal,
  undo_signal: undoSignal,
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
