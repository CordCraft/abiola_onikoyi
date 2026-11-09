import { listConnections, markConnection, api, storeInbound } from './accounts.js';
import { htmlToText, stripQuoted, sleep, jitter } from './util.js';

// Outlook / Microsoft 365 watcher through Microsoft Graph delta queries: each poll returns only
// what changed since the saved deltaLink, for the Inbox and Sent Items.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = 'subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,conversationId,internetMessageId,isDraft,inferenceClassification';

async function ingest(conn, m, folder) {
  if (m['@removed'] || m.isDraft) return;
  // Focused Inbox: "other" mail is mostly newsletters and notifications.
  if (folder === 'inbox' && m.inferenceClassification === 'other') return;
  const fromEmail = (m.from?.emailAddress?.address || '').toLowerCase();
  const outgoing = folder === 'sent' || fromEmail === conn.account.toLowerCase();
  const body = m.body?.contentType === 'html' ? htmlToText(m.body.content) : m.body?.content || m.bodyPreview || '';
  await storeInbound({
    source: 'outlook',
    connectionId: conn.id,
    externalId: `outlook:${conn.account}:${m.id}`,
    threadKey: `outlook:${conn.account}:${m.conversationId}`,
    direction: outgoing ? 'out' : 'in',
    sender: fromEmail,
    senderName: m.from?.emailAddress?.name || fromEmail,
    recipients: [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => r.emailAddress?.address).filter(Boolean).join(', ').slice(0, 1000),
    subject: m.subject || '',
    body: stripQuoted(body),
    occurredAt: new Date(m.receivedDateTime || m.sentDateTime || Date.now()),
  });
}

async function syncFolder(conn, folder, deltaLink) {
  const wellKnown = folder === 'sent' ? 'sentitems' : 'inbox';
  // First run: only the last two days, so a fresh connection does not pull years of mail.
  let url = deltaLink || `${GRAPH}/me/mailFolders/${wellKnown}/messages/delta?$select=${SELECT}&$filter=${encodeURIComponent(`receivedDateTime ge ${new Date(Date.now() - 2 * 864e5).toISOString()}`)}`;
  let next = null;
  let pages = 0;
  while (url && pages < 20) {
    const res = await api(conn, url, { headers: { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=25' } });
    for (const m of res.value || []) {
      await ingest(conn, m, folder).catch((e) => console.error('[outlook] message', e.message));
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

export async function pollOutlook() {
  const conns = await listConnections('microsoft');
  for (const conn of conns) {
    try {
      let cursor = {};
      try { cursor = conn.cursor ? JSON.parse(conn.cursor) : {}; } catch { cursor = {}; }
      cursor.inbox = await syncFolder(conn, 'inbox', cursor.inbox);
      await sleep(jitter(1500));
      cursor.sent = await syncFolder(conn, 'sent', cursor.sent);
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

export async function sendOutlook(conn, { to, subject, body, replyToMessageId }) {
  if (replyToMessageId) {
    return api(conn, `${GRAPH}/me/messages/${replyToMessageId}/reply`, { method: 'POST', body: JSON.stringify({ comment: body }) });
  }
  return api(conn, `${GRAPH}/me/sendMail`, {
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

export async function outlookDraft(conn, { to, subject, body, replyToMessageId }) {
  if (replyToMessageId) {
    const draft = await api(conn, `${GRAPH}/me/messages/${replyToMessageId}/createReply`, { method: 'POST', body: JSON.stringify({ comment: body }) });
    return draft;
  }
  return api(conn, `${GRAPH}/me/messages`, {
    method: 'POST',
    body: JSON.stringify({
      subject: subject || '',
      body: { contentType: 'Text', content: body },
      toRecipients: String(to).split(/[,;]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })),
    }),
  });
}
