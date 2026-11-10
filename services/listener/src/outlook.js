import { listConnections, markConnection, api, storeInbound } from './accounts.js';
import { getSetting, setSetting } from './db.js';
import { htmlToText, stripQuoted, sleep, jitter } from './util.js';

// Outlook / Microsoft 365 watcher through Microsoft Graph delta queries: each poll returns only
// what changed since the saved deltaLink, for the Inbox and Sent Items.
// Shared mailboxes (JarvisSetting "outlook_shared_mailboxes": [{ mailbox, via }]) are read
// through the signed-in account `via` (a connection id) at /users/{mailbox}. That needs the
// Mail.Read.Shared scope and Full Access for that user on the shared mailbox in Exchange.

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Graph base for a mailbox: the signed-in user's own, or a shared one they have access to.
export function mailboxBase(conn, mailbox) {
  return mailbox && mailbox.toLowerCase() !== conn.account.toLowerCase()
    ? `${GRAPH}/users/${encodeURIComponent(mailbox)}`
    : `${GRAPH}/me`;
}
const SELECT = 'subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,conversationId,internetMessageId,isDraft,inferenceClassification';

async function ingest(conn, m, folder, mailbox) {
  if (m['@removed'] || m.isDraft) return;
  const account = mailbox || conn.account;
  // Focused Inbox: "other" mail is mostly newsletters and notifications.
  if (folder === 'inbox' && m.inferenceClassification === 'other') return;
  const fromEmail = (m.from?.emailAddress?.address || '').toLowerCase();
  const outgoing = folder === 'sent' || fromEmail === account.toLowerCase();
  const body = m.body?.contentType === 'html' ? htmlToText(m.body.content) : m.body?.content || m.bodyPreview || '';
  await storeInbound({
    source: 'outlook',
    connectionId: conn.id,
    externalId: `outlook:${account}:${m.id}`,
    threadKey: `outlook:${account}:${m.conversationId}`,
    direction: outgoing ? 'out' : 'in',
    sender: fromEmail,
    senderName: m.from?.emailAddress?.name || fromEmail,
    recipients: [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => r.emailAddress?.address).filter(Boolean).join(', ').slice(0, 1000),
    subject: m.subject || '',
    body: stripQuoted(body),
    occurredAt: new Date(m.receivedDateTime || m.sentDateTime || Date.now()),
  });
}

async function syncFolder(conn, folder, deltaLink, mailbox = null) {
  const wellKnown = folder === 'sent' ? 'sentitems' : 'inbox';
  // First run: only the last two days, so a fresh connection does not pull years of mail.
  let url = deltaLink || `${mailboxBase(conn, mailbox)}/mailFolders/${wellKnown}/messages/delta?$select=${SELECT}&$filter=${encodeURIComponent(`receivedDateTime ge ${new Date(Date.now() - 2 * 864e5).toISOString()}`)}`;
  let next = null;
  let pages = 0;
  while (url && pages < 20) {
    const res = await api(conn, url, { headers: { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=25' } });
    for (const m of res.value || []) {
      await ingest(conn, m, folder, mailbox).catch((e) => console.error('[outlook] message', e.message));
    }
    pages += 1;
    if (res['@odata.nextLink']) {
      url = res['@odata.nextLink'];
      await sleep(jitter(800));
    } else {
      next = res['@odata.deltaLink'] || null;
      url = null;
    }
  }
  return next || deltaLink;
}

async function sharedFor(conn) {
  const list = await getSetting('outlook_shared_mailboxes', []);
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && x.via === conn.id && typeof x.mailbox === 'string' && x.mailbox.includes('@'))
    .map((x) => x.mailbox.trim().toLowerCase());
}

// Shared mailboxes read through this account. Each keeps its own delta cursors and its health
// goes to JarvisSetting "outlook_shared_status" for the Connect page. A failing shared mailbox
// never breaks the owner's own mailbox sync.
async function syncShared(conn, cursor) {
  const boxes = await sharedFor(conn);
  if (!boxes.length) {
    delete cursor.shared;
    return;
  }
  cursor.shared = cursor.shared || {};
  for (const k of Object.keys(cursor.shared)) if (!boxes.includes(k)) delete cursor.shared[k];
  const status = (await getSetting('outlook_shared_status', {})) || {};
  for (const box of boxes) {
    const c = cursor.shared[box] || {};
    try {
      await sleep(jitter(1500));
      c.inbox = await syncFolder(conn, 'inbox', c.inbox, box);
      await sleep(jitter(1500));
      c.sent = await syncFolder(conn, 'sent', c.sent, box);
      cursor.shared[box] = c;
      status[box] = { via: conn.account, lastSyncAt: new Date().toISOString(), error: null };
    } catch (e) {
      console.error(`[outlook] shared ${box} via ${conn.account}:`, e.message);
      if (e.status === 410) delete cursor.shared[box];
      const hint = e.status === 403 || e.status === 401
        ? 'access denied: give the signed-in user Full Access to this mailbox, then reconnect Outlook so Jarvis gets Mail.Read.Shared'
        : e.status === 404
          ? 'mailbox not found, check the address'
          : e.message;
      status[box] = { via: conn.account, lastSyncAt: status[box]?.lastSyncAt || null, error: String(hint).slice(0, 300) };
    }
  }
  await setSetting('outlook_shared_status', status).catch(() => {});
}

export async function pollOutlook() {
  const conns = await listConnections('microsoft');
  for (const conn of conns) {
    try {
      let cursor = {};
      try { cursor = conn.cursor ? JSON.parse(conn.cursor) : {}; } catch { cursor = {}; }
      cursor.inbox = await syncFolder(conn, 'inbox', cursor.inbox);
      await sleep(jitter(1500));
      cursor.sent = await syncFolder(conn, 'sent', cursor.sent);
      await syncShared(conn, cursor);
      await markConnection(conn.id, { cursor: JSON.stringify(cursor), lastSyncAt: new Date(), status: 'active', lastError: null });
    } catch (e) {
      console.error(`[outlook] ${conn.account}:`, e.message);
      // A broken delta link (410) resets that account's cursor; next poll starts fresh.
      if (e.status === 410) await markConnection(conn.id, { cursor: null }).catch(() => {});
      if (conn.status !== 'needs_reauth') await markConnection(conn.id, { lastError: e.message.slice(0, 300) }).catch(() => {});
    }
    await sleep(jitter(4000));
  }
}

export async function sendOutlook(conn, { to, subject, body, replyToMessageId, mailbox }) {
  const base = mailboxBase(conn, mailbox);
  if (replyToMessageId) {
    return api(conn, `${base}/messages/${replyToMessageId}/reply`, { method: 'POST', body: JSON.stringify({ comment: body }) });
  }
  return api(conn, `${base}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: subject || '',
        body: { contentType: 'Text', content: body },
        toRecipients: String(to).split(/[,;]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
}

export async function outlookDraft(conn, { to, subject, body, replyToMessageId, mailbox }) {
  const base = mailboxBase(conn, mailbox);
  if (replyToMessageId) {
    const draft = await api(conn, `${base}/messages/${replyToMessageId}/createReply`, { method: 'POST', body: JSON.stringify({ comment: body }) });
    return draft;
  }
  return api(conn, `${base}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      subject: subject || '',
      body: { contentType: 'Text', content: body },
      toRecipients: String(to).split(/[,;]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })),
    }),
  });
}
