// Hostfully connector: polls guest messages (Airbnb, Booking.com, VRBO threads managed in Hostfully)
// into JarvisInbound and sends replies back through POST /messages. Modelled on reply-guard's client.
// No key = the loop is a no-op. Nothing here throws out of the loop.
import { getSetting, setSetting } from './db.js';
import { storeInbound } from './accounts.js';

export const DEFAULT_AGENCY_UID = 'fc7e2e91-46ea-4f33-92b5-7157551f4a26';
const PROPERTY_TTL_MS = 6 * 3600_000;
const FIRST_RUN_BACKFILL_MS = 48 * 3600_000;
const CURSOR_OVERLAP_MS = 5 * 60_000; // re-read a little; externalId makes it idempotent
const POLL_MS = 2 * 60_000;
const MAX_PAGES = 10;

export function hostfullyConfig(env = process.env) {
  return {
    apiKey: env.HOSTFULLY_API_KEY || '',
    agencyUid: env.HOSTFULLY_AGENCY_UID || DEFAULT_AGENCY_UID,
    baseUrl: (env.HOSTFULLY_BASE_URL || 'https://api.hostfully.com/api/v3.2').replace(/\/$/, ''),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- client ---------------------------------------------------------------------------------

export function makeClient({ cfg = hostfullyConfig(), fetchImpl = (...a) => fetch(...a), retries = 3, baseDelayMs = 1000 } = {}) {
  async function request(method, path, { query, body } = {}) {
    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method,
          headers: {
            'X-HOSTFULLY-APIKEY': cfg.apiKey,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers?.get?.('retry-after'));
          lastErr = new Error(`Hostfully ${method} ${url.pathname} -> ${res.status}`);
          if (attempt < retries) { await sleep(ra > 0 ? Math.min(ra * 1000, 30_000) : baseDelayMs * 2 ** attempt); continue; }
          throw lastErr;
        }
        if (!res.ok) throw new Error(`Hostfully ${method} ${url.pathname} -> ${res.status}: ${text.slice(0, 300)}`);
        return text ? JSON.parse(text) : {};
      } catch (e) {
        lastErr = e;
        const transient = e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError; // network failure
        if (transient && attempt < retries) { await sleep(baseDelayMs * 2 ** attempt); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  async function paged(path, listKey, query, maxPages = MAX_PAGES) {
    const out = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const data = await request('GET', path, { query: { ...query, _limit: 100, _cursor: cursor } });
      out.push(...(data[listKey] || []));
      cursor = data._paging?._nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  return {
    cfg,
    request,
    listProperties: () => paged('/properties', 'properties', { agencyUid: cfg.agencyUid }, 20),
    listMessages: (query, maxPages) => paged('/messages', 'messages', { agencyUid: cfg.agencyUid, ...query }, maxPages),
    listLeads: (query, maxPages = 5) => paged('/leads', 'leads', { agencyUid: cfg.agencyUid, ...query }, maxPages),
    async getLead(uid) { return (await request('GET', `/leads/${uid}`)).lead || null; },
    sendRaw: (body) => request('POST', '/messages', { body }),
  };
}

// --- normalisation -------------------------------------------------------------------------

// Hostfully timestamps are UTC but sometimes come without a "Z".
export function parseUtc(s) {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** GUEST -> 'in'; AGENCY/OWNER -> 'out'; SYSTEM (automated/scheduled templates) -> 'out' flagged auto. */
export function classifySender(senderType) {
  const t = String(senderType || '').toUpperCase();
  if (t === 'GUEST') return { direction: 'in', auto: false };
  if (t === 'SYSTEM' || t === 'AUTOMATED' || t === 'AUTOMATION') return { direction: 'out', auto: true };
  if (t === 'AGENCY' || t === 'OWNER' || t === 'HOST' || t === 'CO_HOST') return { direction: 'out', auto: false };
  return { direction: 'in', auto: false, unknown: true }; // unknown sender types count as guest so nothing is missed
}

export function normalizeMessage(m) {
  return {
    uid: m.uid,
    threadUid: m.threadUid || null,
    leadUid: m.leadUid || null,
    propertyUid: m.propertyUid || null,
    senderType: m.senderType,
    status: m.status,
    createdAt: parseUtc(m.createdUtcDateTime),
    text: m.content?.text || m.content?.body || '',
    channel: m.type || null,
  };
}

const day = (s) => String(s || '').slice(0, 10);

export function buildInbound(msg, { propertyName, lead } = {}) {
  const { direction, auto } = classifySender(msg.senderType);
  const g = lead?.guestInformation || {};
  const guestName = [g.firstName, g.lastName].filter(Boolean).join(' ') || null;
  const ci = day(lead?.checkInLocalDateTime || lead?.checkInZonedDateTime);
  const co = day(lead?.checkOutLocalDateTime || lead?.checkOutZonedDateTime);
  const key = msg.threadUid || msg.leadUid;
  const subject = [propertyName || 'Hostfully', ci && co ? `${ci}-${co}` : ci || ''].filter(Boolean).join(', ');
  const sender = direction === 'in' ? (guestName || 'guest') : (auto ? 'hostfully-auto' : 'host');
  return {
    source: 'hostfully',
    externalId: `hostfully:${msg.uid}`,
    threadKey: `hostfully:${key}`,
    sender,
    senderName: direction === 'in' ? guestName : (auto ? 'Hostfully automated' : 'Host'),
    subject,
    body: (auto ? '[auto] ' : '') + msg.text,
    occurredAt: msg.createdAt || new Date(),
    direction,
  };
}

// --- polling -------------------------------------------------------------------------------

const state = { props: null, leads: new Map() }; // in-memory caches (properties 6 h, leads 1 h)

export function resetCaches() { state.props = null; state.leads.clear(); }

async function properties(client, now) {
  if (state.props && now - state.props.at < PROPERTY_TTL_MS) return state.props.map;
  const map = new Map();
  for (const p of await client.listProperties()) map.set(p.uid, p.name || p.uid);
  state.props = { at: now, map };
  return map;
}

async function leadFor(client, uid, now) {
  if (!uid) return null;
  const hit = state.leads.get(uid);
  if (hit && now - hit.at < 3600_000) return hit.lead;
  let lead = null;
  try { lead = await client.getLead(uid); } catch { /* subject falls back to the property name */ }
  state.leads.set(uid, { at: now, lead });
  return lead;
}

/**
 * One poll. deps are injectable for tests: { client, getSetting, setSetting, storeInbound, now }.
 * Returns { properties, messages, stored }. Throws on API failure (the loop catches it).
 */
export async function pollHostfully(deps = {}) {
  const client = deps.client || makeClient();
  const get = deps.getSetting || getSetting;
  const set = deps.setSetting || setSetting;
  const store = deps.storeInbound || storeInbound;
  const now = deps.now ? deps.now() : Date.now();

  const props = await properties(client, now);
  const cur = await get('hostfully_cursor', null);
  const parsed = cur && typeof cur === 'object' ? parseUtc(cur.since) : null;
  const since = parsed ? new Date(parsed.getTime() - CURSOR_OVERLAP_MS) : new Date(now - FIRST_RUN_BACKFILL_MS);
  const createdAt = since.toISOString().replace(/\.\d+Z$/, 'Z');

  const raw = (await client.listMessages({ createdAt })).map(normalizeMessage)
    .filter((m) => m.uid && (m.threadUid || m.leadUid) && m.text.trim() && m.status !== 'FAILED' && (!m.createdAt || m.createdAt >= since))
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

  let stored = 0;
  let newest = parsed;
  for (const msg of raw) {
    const lead = await leadFor(client, msg.leadUid, now);
    const propertyUid = msg.propertyUid || lead?.propertyUid;
    const id = await store(buildInbound(msg, { propertyName: props.get(propertyUid), lead }));
    if (id) stored++;
    if (msg.createdAt && (!newest || msg.createdAt > newest)) newest = msg.createdAt;
  }
  // Only move the cursor forward on messages actually read, so an empty hiccup never skips time.
  if (newest && (!parsed || newest > parsed)) await set('hostfully_cursor', { since: newest.toISOString() });
  else if (!parsed) await set('hostfully_cursor', { since: new Date(now).toISOString() });
  return { properties: props.size, messages: raw.length, stored };
}

// --- sending -------------------------------------------------------------------------------

/** threadKey 'hostfully:<uid>' where uid is a threadUid (or a leadUid when the message had no thread). */
export async function sendHostfullyMessage({ threadKey, text }, deps = {}) {
  const client = deps.client || makeClient();
  const uid = String(threadKey || '').replace(/^hostfully:/, '');
  if (!uid || !text || !String(text).trim()) throw new Error('hostfully send needs a threadKey and text');
  let msgs = await client.listMessages({ threadUid: uid }, 1);
  if (!msgs.length) msgs = await client.listMessages({ leadUid: uid }, 1);
  const ref = msgs[0];
  if (!ref) throw new Error(`Hostfully thread ${uid} not found`);
  const channel = String(ref.type || '').toUpperCase();
  const direct = !channel || channel.includes('MESSAGE') || ['AIRBNB', 'BOOKING_COM', 'VRBO'].includes(channel);
  const body = {
    leadUid: ref.leadUid,
    threadUid: ref.threadUid || undefined,
    type: direct ? 'DIRECT_MESSAGE' : 'EMAIL',
    content: direct ? { text } : { subject: 'Your stay', text },
  };
  const res = await client.sendRaw(body);
  return { ok: true, messageUid: res?.uid || res?.message?.uid || null };
}

// --- loop ----------------------------------------------------------------------------------

export async function startHostfullyLoop(log = console.log, env = process.env) {
  const cfg = hostfullyConfig(env);
  if (!cfg.apiKey) { log('hostfully: no HOSTFULLY_API_KEY, connector off'); return { stop() {} }; }
  const client = makeClient({ cfg });
  let stopped = false;
  let timer;
  const run = async () => {
    const startedAt = new Date().toISOString();
    try {
      const r = await pollHostfully({ client });
      await setSetting('hostfully_status', { ok: true, lastRunAt: startedAt, lastError: null, properties: r.properties, messages: r.messages }).catch(() => {});
      if (r.stored) log(`hostfully: ${r.stored} new message(s)`);
    } catch (e) {
      log(`hostfully: poll failed: ${e.message}`);
      await setSetting('hostfully_status', { ok: false, lastRunAt: startedAt, lastError: String(e.message).slice(0, 300), properties: 0, messages: 0 }).catch(() => {});
    }
    if (!stopped) timer = setTimeout(run, POLL_MS + Math.floor(Math.random() * 20_000));
  };
  timer = setTimeout(run, 3000);
  log('hostfully: polling every 2 minutes');
  return { stop() { stopped = true; clearTimeout(timer); } };
}

// --- Airbnb notification emails ----------------------------------------------------------------

const AIRBNB_DOMAIN = /@([\w-]+\.)*(airbnb\.[a-z.]+|airbnbmail\.com)\b/i;
const AIRBNB_SUBJECT = /^\s*((re|fw|fwd):\s*)*(reservation (for|request|confirmed|reminder|alteration|update|cancelled|canceled)|inquiry for|message from|new message|booking (confirmed|request)|request to book|pre-?approv)/i;

/** True for Airbnb notification emails about guest messages or reservations (Hostfully has the source of truth). */
export function isAirbnbGuestNotification(inbound) {
  if (!inbound) return false;
  if (!AIRBNB_DOMAIN.test(String(inbound.sender || ''))) return false;
  const subject = String(inbound.subject || '');
  return AIRBNB_SUBJECT.test(subject) || /(reservation for|inquiry for|message from)/i.test(subject);
}
