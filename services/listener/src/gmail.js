import { listConnections, markConnection, api, storeInbound } from './accounts.js';
import { htmlToText, stripQuoted, sleep, jitter } from './util.js';

// Gmail watcher: the History API gives "what changed since cursor", so each poll is small.
// Every connected Gmail account is visited in turn with a pause between them.

const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SKIP_LABELS = new Set(['SPAM', 'TRASH', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

function header(msg, name) {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeB64(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function bodyText(payload) {
  let plain = '';
  let html = '';
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeB64(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeB64(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return plain || htmlToText(html);
}

function parseAddress(v) {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(v || '');
  return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: String(v || '').trim().toLowerCase() };
}

async function ingestMessage(conn, id) {
  const msg = await api(conn, `${G}/messages/${id}?format=full`);
  const labels = new Set(msg.labelIds || []);
  if ([...labels].some((l) => SKIP_LABELS.has(l))) return;
  if (labels.has('DRAFT')) return;
  const from = parseAddress(header(msg, 'From'));
  const outgoing = labels.has('SENT') || from.email === conn.account.toLowerCase();
  const text = stripQuoted(bodyText(msg.payload) || msg.snippet || '');
  await storeInbound({
    source: 'gmail',
    connectionId: conn.id,
    externalId: `gmail:${conn.account}:${msg.id}`,
    threadKey: `gmail:${conn.account}:${msg.threadId}`,
    direction: outgoing ? 'out' : 'in',
    sender: from.email,
    senderName: from.name || from.email,
    recipients: [header(msg, 'To'), header(msg, 'Cc')].filter(Boolean).join(', ').slice(0, 1000),
    subject: header(msg, 'Subject'),
    body: text,
    occurredAt: new Date(Number(msg.internalDate) || Date.now()),
  });
}

async function pollOne(conn) {
  if (!conn.cursor) {
    // First visit: remember where history starts, then backfill only the last two days of inbox.
    const profile = await api(conn, `${G}/profile`);
    const list = await api(conn, `${G}/messages?maxResults=25&q=${encodeURIComponent('newer_than:2d -category:promotions -category:social')}`);
    for (const m of list.messages || []) {
      await ingestMessage(conn, m.id).catch((e) => console.error('[gmail] backfill', e.message));
      await sleep(jitter(700));
    }
    await markConnection(conn.id, { cursor: String(profile.historyId), lastSyncAt: new Date(), status: 'active', lastError: null });
    return;
  }
  let pageToken = '';
  let latest = conn.cursor;
  const ids = new Set();
  do {
    let res;
    try {
      res = await api(conn, `${G}/history?startHistoryId=${conn.cursor}&historyTypes=messageAdded&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
    } catch (e) {
      if (e.status === 404) {
        // Cursor too old (Gmail keeps about a week): start again from now.
        await markConnection(conn.id, { cursor: null });
        return;
      }
      throw e;
    }
    for (const h of res.history || []) for (const a of h.messagesAdded || []) ids.add(a.message.id);
    if (res.historyId) latest = String(res.historyId);
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  for (const id of ids) {
    await ingestMessage(conn, id).catch((e) => console.error('[gmail] message', e.message));
    await sleep(jitter(500));
  }
  await markConnection(conn.id, { cursor: latest, lastSyncAt: new Date(), status: 'active', lastError: null });
}

export async function pollGmail() {
  const conns = await listConnections('google');
  for (const conn of conns) {
    try {
      await pollOne(conn);
    } catch (e) {
      console.error(`[gmail] ${conn.account}:`, e.message);
      if (conn.status !== 'needs_reauth') await markConnection(conn.id, { lastError: e.message.slice(0, 300) }).catch(() => {});
    }
    await sleep(jitter(4000));
  }
}

// Send or reply from a Gmail account (only ever called for an approved job).
export async function sendGmail(conn, { to, subject, body, threadId, inReplyTo }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  const raw = Buffer.from(lines.join('\r\n') + '\r\n\r\n' + body).toString('base64url');
  return api(conn, `${G}/messages/send`, { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
}

export async function gmailDraft(conn, { to, subject, body, threadId }) {
  const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject || ''}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`).toString('base64url');
  return api(conn, `${G}/drafts`, { method: 'POST', body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
}
