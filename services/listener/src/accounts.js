import { config } from './config.js';
import { q, one, newId } from './db.js';
import { encrypt, decrypt } from './crypto.js';

// Connected Google / Microsoft accounts (rows the site's OAuth callbacks create).

export async function listConnections(provider) {
  return q(
    `SELECT * FROM "JarvisConnection" WHERE provider = $1 AND status IN ('active','error') ORDER BY "createdAt"`,
    [provider],
  );
}

export async function markConnection(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
  await q(`UPDATE "JarvisConnection" SET ${sets}, "updatedAt" = now() WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
}

const TOKEN_URLS = {
  google: 'https://oauth2.googleapis.com/token',
  microsoft: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

// A fresh access token for a connection, refreshing (and saving) it when it is about to expire.
export async function accessToken(conn) {
  const exp = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  if (conn.accessTokenEnc && exp - Date.now() > 120_000) return decrypt(conn.accessTokenEnc);
  const refresh = decrypt(conn.refreshTokenEnc);
  if (!refresh) throw new Error('no refresh token, reconnect this account');
  const creds = conn.provider === 'google' ? config.google : config.microsoft;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  if (conn.provider === 'microsoft') body.set('scope', conn.scopes || 'offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite');
  const res = await fetch(TOKEN_URLS[conn.provider], { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const reauth = json.error === 'invalid_grant';
    await markConnection(conn.id, { status: reauth ? 'needs_reauth' : 'error', lastError: `token refresh: ${json.error || res.status} ${json.error_description || ''}`.slice(0, 300) });
    throw new Error(`token refresh failed for ${conn.account}: ${json.error || res.status}`);
  }
  const fields = {
    accessTokenEnc: encrypt(json.access_token),
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000),
  };
  if (json.refresh_token) fields.refreshTokenEnc = encrypt(json.refresh_token); // Microsoft rotates them
  await markConnection(conn.id, fields);
  Object.assign(conn, fields);
  return json.access_token;
}

export async function api(conn, url, init = {}) {
  const token = await accessToken(conn);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 30);
    const err = new Error(`rate limited, retry after ${wait}s`);
    err.retryAfter = wait;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${init.method || 'GET'} ${url.split('?')[0]} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res.text();
}

// Everything Jarvis hears goes through here. Idempotent on externalId.
export async function storeInbound(m) {
  const row = await one(
    `INSERT INTO "JarvisInbound" (id, source, "connectionId", "externalId", "threadKey", direction, sender, "senderName",
       recipients, subject, body, "isGroup", "chatName", "occurredAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT ("externalId") DO NOTHING RETURNING id`,
    [
      newId(), m.source, m.connectionId || null, m.externalId, m.threadKey || null, m.direction || 'in',
      m.sender || null, m.senderName || null, m.recipients || null, m.subject || null,
      String(m.body || '').slice(0, 12000), !!m.isGroup, m.chatName || null, m.occurredAt || new Date(),
    ],
  );
  return row?.id || null;
}
