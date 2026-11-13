import test from 'node:test';
import assert from 'node:assert/strict';
process.env.JARVIS_ENCRYPTION_KEY = 'test-key-123';
process.env.DATABASE_URL = 'postgres://x:y@localhost:1/none';
const h = await import('../src/hostfully.js');

const cfg = { apiKey: 'k', agencyUid: 'ag1', baseUrl: 'https://hf.test/api/v3.3' };
const res = (obj, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(obj) });

function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), method: opts.method, headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    return routes(u, opts);
  };
}

const MSGS = [
  { uid: 'm1', threadUid: 't1', leadUid: 'l1', propertyUid: 'p1', senderType: 'GUEST', createdUtcDateTime: '2026-11-12T10:00:00', content: { text: 'Is early check-in ok?' }, type: 'DIRECT_MESSAGE' },
  { uid: 'm2', threadUid: 't1', leadUid: 'l1', propertyUid: 'p1', senderType: 'AGENCY', createdUtcDateTime: '2026-11-12T10:05:00', content: { text: 'Yes of course' } },
  { uid: 'm3', threadUid: 't1', leadUid: 'l1', propertyUid: 'p1', senderType: 'SYSTEM', createdUtcDateTime: '2026-11-12T10:06:00', content: { text: 'Check-in details' } },
  { uid: 'm4', leadUid: 'l2', propertyUid: 'p1', senderType: 'GUEST', createdUtcDateTime: '2026-11-12T10:07:00', content: { text: 'No thread here' } },
];

function mkDeps(now = Date.parse('2026-11-12T12:00:00Z'), settings = {}) {
  h.resetCaches();
  const calls = [];
  const stored = [];
  const client = h.makeClient({
    cfg, retries: 0,
    fetchImpl: fakeFetch((u) => {
      if (u.pathname.endsWith('/properties')) return res({ properties: [{ uid: 'p1', name: 'Apple 12' }] });
      if (u.pathname.endsWith('/messages')) return res({ messages: MSGS });
      if (u.pathname.includes('/leads/')) return res({ lead: { propertyUid: 'p1', checkInLocalDateTime: '2026-11-14T15:00:00', checkOutLocalDateTime: '2026-11-17T11:00:00', guestInformation: { firstName: 'Sara', lastName: 'Ali' } } });
      return res({}, 404);
    }, calls),
  });
  return {
    calls, stored, settings,
    deps: {
      client, now: () => now,
      getSetting: async (k, f) => settings[k] ?? f,
      setSetting: async (k, v) => { settings[k] = v; },
      storeInbound: async (m) => { if (stored.some((s) => s.externalId === m.externalId)) return null; stored.push(m); return 'id' + stored.length; },
    },
  };
}

test('sender classification', () => {
  assert.deepEqual(h.classifySender('GUEST'), { direction: 'in', auto: false });
  assert.deepEqual(h.classifySender('AGENCY'), { direction: 'out', auto: false });
  assert.deepEqual(h.classifySender('OWNER'), { direction: 'out', auto: false });
  assert.deepEqual(h.classifySender('SYSTEM'), { direction: 'out', auto: true });
});

test('poll stores messages with externalId, threadKey, subject and auto prefix', async () => {
  const t = mkDeps();
  const r = await h.pollHostfully(t.deps);
  assert.equal(r.properties, 1);
  assert.equal(r.stored, 4);
  const [a, b, c, d] = t.stored;
  assert.equal(a.externalId, 'hostfully:m1');
  assert.equal(a.threadKey, 'hostfully:t1');
  assert.equal(a.source, 'hostfully');
  assert.equal(a.direction, 'in');
  assert.equal(a.sender, 'Sara Ali');
  assert.equal(a.subject, 'Apple 12, 2026-11-14-2026-11-17');
  assert.equal(b.direction, 'out');
  assert.equal(c.direction, 'out');
  assert.equal(c.body, '[auto] Check-in details');
  assert.equal(d.threadKey, 'hostfully:l2'); // falls back to the lead uid
  assert.ok(t.calls.every((x) => x.headers['X-HOSTFULLY-APIKEY'] === 'k'));
  assert.ok(t.calls[0].path.endsWith('/properties'));
});

test('first run backfills 48 h, later runs resume from cursor with overlap', async () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  let t = mkDeps(now);
  await h.pollHostfully(t.deps);
  const first = t.calls.find((c) => c.path.endsWith('/messages'));
  assert.equal(first.q.createdAt, '2026-11-10T12:00:00Z');
  assert.equal(t.settings.hostfully_cursor.since, '2026-11-12T10:07:00.000Z');
  t = mkDeps(now, { hostfully_cursor: { since: '2026-11-12T10:07:00.000Z' } });
  await h.pollHostfully(t.deps);
  assert.equal(t.calls.find((c) => c.path.endsWith('/messages')).q.createdAt, '2026-11-12T10:02:00Z');
  // m1 (10:00) is older than the overlap window and skipped client-side
  assert.deepEqual(t.stored.map((m) => m.externalId), ['hostfully:m2', 'hostfully:m3', 'hostfully:m4']);
});

test('poll is idempotent by externalId', async () => {
  const t = mkDeps();
  await h.pollHostfully(t.deps);
  const again = await h.pollHostfully(t.deps);
  assert.equal(again.stored, 0);
  assert.equal(t.stored.length, 4);
});

test('properties are cached between polls', async () => {
  const t = mkDeps();
  await h.pollHostfully(t.deps);
  await h.pollHostfully(t.deps);
  assert.equal(t.calls.filter((c) => c.path.endsWith('/properties')).length, 1);
});

test('429 is retried, then succeeds', async () => {
  let n = 0;
  const client = h.makeClient({ cfg, retries: 2, baseDelayMs: 1, fetchImpl: async () => (++n < 3 ? res({}, 429) : res({ properties: [{ uid: 'p', name: 'X' }] })) });
  const props = await client.listProperties();
  assert.equal(n, 3);
  assert.equal(props.length, 1);
});

test('send posts a direct message into the thread', async () => {
  const calls = [];
  const client = h.makeClient({ cfg, retries: 0, fetchImpl: fakeFetch((u, o) => (o.method === 'POST' ? res({ uid: 'new1' }) : res({ messages: [MSGS[0]] })), calls) });
  const r = await h.sendHostfullyMessage({ threadKey: 'hostfully:t1', text: 'Welcome' }, { client });
  assert.equal(r.messageUid, 'new1');
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/api/v3.3/messages');
  assert.deepEqual(post.body, { leadUid: 'l1', threadUid: 't1', type: 'DIRECT_MESSAGE', content: { text: 'Welcome' } });
});

test('loop is a no-op without a key', async () => {
  const logs = [];
  const loop = await h.startHostfullyLoop((m) => logs.push(m), {});
  assert.equal(logs.length, 1);
  assert.match(logs[0], /no HOSTFULLY_API_KEY/);
  loop.stop();
});

test('Airbnb notification detector', () => {
  const yes = (sender, subject) => h.isAirbnbGuestNotification({ sender, subject });
  assert.equal(yes('automated@airbnb.com', 'RE: Reservation for Apple 12, Nov 14 - 17'), true);
  assert.equal(yes('express@airbnb.com', 'Inquiry for Apple 12 for Nov 14 - 17'), true);
  assert.equal(yes('automated@airbnb.com', 'Message from Sara'), true);
  assert.equal(yes('x@mail.airbnb.com', 'Reservation request: Sara'), true);
  assert.equal(yes('x@mail.airbnb.com', 'Reservation confirmed - Sara arrives'), true);
  assert.equal(yes('friend@gmail.com', 'RE: Reservation for dinner'), false);
  assert.equal(yes('automated@airbnb.com', 'Your payout is on the way'), false);
  assert.equal(h.isAirbnbGuestNotification(null), false);
});

test('send: ignores messages that are not from the requested thread', async () => {
  const sent = [];
  const mk = (rows) => ({ listMessages: async () => rows, sendRaw: async (b) => { sent.push(b); return { uid: 'x' }; } });
  await assert.rejects(h.sendHostfullyMessage({ threadKey: 'hostfully:t1', text: 'Hi' }, { client: mk([{ uid: 'm', threadUid: 'other', leadUid: 'L9', type: 'DIRECT_MESSAGE' }]) }), /not found/);
  assert.equal(sent.length, 0, 'nothing is sent to an unrelated guest');
  await h.sendHostfullyMessage({ threadKey: 'hostfully:t1', text: 'Hi' }, { client: mk([{ uid: 'a', threadUid: 'other', leadUid: 'L9' }, { uid: 'b', threadUid: 't1', leadUid: 'L1', type: 'DIRECT_MESSAGE' }]) });
  assert.equal(sent[0].leadUid, 'L1');
});
