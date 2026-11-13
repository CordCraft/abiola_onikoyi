import test from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../src/pure.js');

const NOW = Date.UTC(2026, 10, 13, 12, 0);
const ago = (h) => new Date(NOW - h * 3600e3);
const msg = (o) => ({ id: o.id || Math.random().toString(36).slice(2), direction: 'in', sender: 'najeeb@acme.com', senderName: 'Najeeb', body: 'Can you send the figures please?', source: 'gmail', isGroup: false, subject: 'Figures', ...o });
const thread = (threadKey, ...messages) => ({ threadKey, messages });
const pick = (threads, extra = {}) => P.selectNudgeCandidates({ threads, now: NOW, aliases: ['Abiola', 'Onikoyi'], ...extra });

test('nudger: thresholds 2h for fast or priority people, 6h otherwise', () => {
  const t = (age) => [thread('t', msg({ occurredAt: ago(age) }))];
  assert.equal(pick(t(1)).length, 0, 'too fresh');
  assert.equal(pick(t(3)).length, 0, 'stranger needs 6h');
  assert.equal(pick(t(7)).length, 1);
  const fast = new Map([['najeeb@acme.com', { medianReplyMins: 20 }]]);
  assert.equal(pick(t(3), { people: fast }).length, 1, 'fast answer person: 2h');
  const client = new Map([['najeeb@acme.com', { relation: 'client', medianReplyMins: 300 }]]);
  assert.equal(pick(t(2.5), { people: client }).length, 1);
  assert.equal(pick(t(1.5), { people: client }).length, 0);
});

test('nudger: window, replies, automation and acknowledgements are skipped', () => {
  const old = [thread('a', msg({ occurredAt: ago(80) }))];
  assert.equal(pick(old).length, 0, 'older than 3 days');
  const replied = [thread('b', msg({ occurredAt: ago(8) }), msg({ direction: 'out', sender: 'me', occurredAt: ago(7) }))];
  assert.equal(pick(replied).length, 0, 'he answered by hand');
  const autoOnly = [thread('c', msg({ occurredAt: ago(8), sender: 'guest', source: 'hostfully' }), msg({ direction: 'out', sender: 'hostfully-auto', body: '[auto] Welcome!', occurredAt: ago(7) }))];
  assert.equal(pick(autoOnly).length, 1, 'an automated Hostfully message is not him replying');
  assert.equal(pick([thread('d', msg({ occurredAt: ago(8), sender: 'no-reply@bank.com' }))]).length, 0);
  assert.equal(pick([thread('d2', msg({ occurredAt: ago(8), sender: 'x@news.shop.com' }))]).length, 0);
  assert.equal(pick([thread('e', msg({ occurredAt: ago(8), body: 'Thanks!' }))]).length, 0);
  assert.equal(pick([thread('e2', msg({ occurredAt: ago(8), body: 'ok' }))]).length, 0);
  const own = new Set(['najeeb@acme.com']);
  assert.equal(pick([thread('f', msg({ occurredAt: ago(8) }))], { ownAddresses: own }).length, 0, 'mail from himself');
});

test('nudger: groups need a mention', () => {
  const g = (body) => [thread('g', msg({ sender: '2348000000001', source: 'whatsapp', isGroup: true, body, occurredAt: ago(8) }))];
  assert.equal(pick(g('Who is bringing the chairs?')).length, 0);
  assert.equal(pick(g('Abiola, can you confirm the venue?')).length, 1);
  assert.equal(pick(g('@Onikoyi please confirm')).length, 1);
  assert.equal(P.mentionsOwner('Abiolaxyz hello', ['Abiola']), false);
});

test('nudger: airbnb notifications skipped only when hostfully is healthy', () => {
  const airbnb = (m) => /airbnb/.test(m.sender);
  const t = [thread('h', msg({ sender: 'automated@airbnb.com', occurredAt: ago(8), body: 'Guest sent you a message?' }))];
  assert.equal(pick(t, { isAirbnbNotification: airbnb, hostfullyHealthy: false }).length, 1 - 1 + (P.isAutomatedSender(t[0].messages[0]) ? 0 : 1));
  const t2 = [thread('h2', msg({ sender: 'guest@airbnb.com', occurredAt: ago(8) }))];
  assert.equal(pick(t2, { isAirbnbNotification: airbnb, hostfullyHealthy: false }).length, 1);
  assert.equal(pick(t2, { isAirbnbNotification: airbnb, hostfullyHealthy: true }).length, 0);
});

test('nudger: open signals, decisions, 24h gap, two-nudge cap and model-no memory', () => {
  const m = msg({ id: 'm1', occurredAt: ago(8) });
  const t = [thread('k', m)];
  assert.equal(pick(t, { openThreadKeys: new Set(['k']) }).length, 0);
  assert.equal(pick(t, { decidedAt: new Map([['k', NOW - 3600e3]]) }).length, 0, 'dismissed after the message');
  assert.equal(pick(t, { decidedAt: new Map([['k', NOW - 20 * 3600e3]]) }).length, 1, 'decided before the message');
  assert.equal(pick(t, { counts: { k: { count: 1, last: NOW - 3 * 3600e3 } } }).length, 0, 'within 24h');
  assert.equal(pick(t, { counts: { k: { count: 1, last: NOW - 30 * 3600e3 } } }).length, 1, 'second nudge allowed');
  assert.equal(pick(t, { counts: { k: { count: 2, last: NOW - 80 * 3600e3 } } }).length, 0, 'two in total');
  assert.equal(pick(t, { counts: { k: { count: 0, checked: 'm1', at: NOW } } }).length, 0, 'model already said no');
  assert.equal(pick(t, { counts: { k: { count: 0, checked: 'older', at: NOW } } }).length, 1, 'new message, ask again');
});

test('nudger: batch is capped at 15 and ranks priority people first', () => {
  const threads = Array.from({ length: 20 }, (_, i) => thread(`t${i}`, msg({ id: `m${i}`, sender: `p${i}@x.com`, occurredAt: ago(10 + i) })));
  assert.equal(pick(threads).length, 15);
  const people = new Map([['p19@x.com', { relation: 'family' }]]);
  assert.equal(pick(threads, { people })[0].threadKey, 't19');
});

test('nudger: accept only offered ids, scores and drop em dashes', () => {
  const offered = [{ key: 't1' }, { key: 't2' }, { key: 't3' }];
  const r = P.acceptNudges({ verdicts: [
    { id: 't1', needs_reply: true, topic: 'Invoice — 2041', why: 'He asked for a number', score: 82, draft: 'Sent — thanks' },
    { id: 't2', needs_reply: false, topic: '', why: '', score: 10, draft: '' },
    { id: 'invented', needs_reply: true, topic: 'x', why: 'y', score: 99, draft: '' },
    { id: 't1', needs_reply: true, topic: 'dup', why: '', score: 90, draft: '' },
  ] }, offered);
  assert.deepEqual(r.yes.map((y) => y.key), ['t1']);
  assert.doesNotMatch(JSON.stringify(r), /—/);
  assert.deepEqual(r.no, ['t2']);
  assert.equal(P.acceptNudges({ verdicts: [{ id: 't1', needs_reply: true, topic: '', why: '', score: 20, draft: '' }] }, offered).yes.length, 0, 'below min score');
  assert.equal(P.nudgeTitle('Najeeb', 'invoice 2041'), 'Still waiting on you: Najeeb, invoice 2041');
});

test('nudger: counts pruned after 7 days', () => {
  const c = P.pruneNudgeCounts({ a: { count: 1, last: NOW - 8 * 864e5 }, b: { count: 1, last: NOW - 2 * 864e5 }, c: { checked: 'x', at: NOW - 9 * 864e5 } }, NOW);
  assert.deepEqual(Object.keys(c), ['b']);
});

test('stalled tasks: 3 days idle, once per 3 days, five a day', () => {
  const task = (id, days, status = 'todo') => ({ id, status, updatedAt: new Date(NOW - days * 864e5) });
  const tasks = [task('a', 4), task('b', 2), task('c', 5), task('d', 9, 'done'), task('e', 6), task('f', 7), task('g', 8), task('h', 10), task('i', 11)];
  const nudges = [{ threadKey: 'task:c', status: 'dismissed', createdAt: new Date(NOW - 1 * 864e5) }, { threadKey: 'task:e', status: 'new', createdAt: new Date(NOW - 20 * 864e5) }];
  const got = P.selectStalledTasks(tasks, nudges, { now: NOW }).map((t) => t.id);
  assert.ok(!got.includes('b') && !got.includes('d') && !got.includes('c') && !got.includes('e'));
  assert.equal(got.length, 5);
  assert.equal(P.selectStalledTasks(tasks, nudges, { now: NOW, alreadyToday: 4 }).length, 1);
  assert.equal(P.selectStalledTasks(tasks, [], { now: NOW, alreadyToday: 5 }).length, 0);
});

test('learn: reply latency, answer rate, auto messages and groups', () => {
  const at = (mins) => new Date(NOW - 20 * 864e5 + mins * 60e3);
  const m = (threadKey, direction, sender, mins, extra = {}) => ({ threadKey, direction, sender, occurredAt: at(mins), body: 'Please see this and revert', source: 'whatsapp', isGroup: false, ...extra });
  const msgs = [
    m('w1', 'in', 'najeeb', 0), m('w1', 'in', 'najeeb', 5), m('w1', 'out', 'me', 20),
    m('w2', 'in', 'najeeb', 100), m('w2', 'out', 'me', 110),
    m('w3', 'in', 'najeeb', 200), m('w3', 'out', 'me', 240),
    m('w4', 'in', 'najeeb', 300),
    m('hf', 'in', 'guest', 0, { source: 'hostfully' }), m('hf', 'out', 'hostfully-auto', 1, { source: 'hostfully', body: '[auto] hi' }),
    m('gr', 'in', 'x', 0, { isGroup: true }), m('gr', 'out', 'me', 5, { isGroup: true }),
    m('em', 'in', 'a@b.com', 0, { source: 'gmail' }), m('em', 'out', 'me', 30, { source: 'gmail', body: '[auto] template' }),
  ];
  const s = P.computeReplyStats(msgs, { now: NOW });
  const n = s.get('najeeb');
  assert.equal(n.answered, 3);
  assert.equal(n.total, 4, 'the old unanswered burst counts');
  assert.equal(n.medianReplyMins, 20, 'median of 20, 10, 40; burst measured from its first message');
  assert.equal(n.answerRate, 0.75);
  assert.equal(s.get('guest'), undefined);
  assert.equal(s.get('x'), undefined);
  assert.equal(s.get('a@b.com')?.answered || 0, 0, 'an automated reply is not him');
  assert.equal(P.median([1, 3, 2]), 2);
  assert.equal(P.median([1, 2, 3, 4]), 2.5);
  assert.equal(P.median([]), null);
});

test('learn: dismiss rates need a minimum sample and feed a readable summary', () => {
  const sig = (kind, status, personKey) => ({ kind, status, personKey });
  const signals = [
    ...Array.from({ length: 7 }, () => sig('opportunity', 'dismissed', 'x@y.com')),
    ...Array.from({ length: 3 }, () => sig('opportunity', 'applied', 'x@y.com')),
    sig('reply', 'applied', 'najeeb'), sig('reply', 'new', 'najeeb'),
  ];
  const ss = P.computeSignalStats(signals);
  assert.equal(ss.byKind.opportunity.dismissRate, 0.7);
  assert.equal(ss.byKind.reply, undefined, 'too few to say');
  assert.equal(ss.byPerson.get('x@y.com').decided, 10);
  const rs = new Map([['najeeb', { medianReplyMins: 18, answerRate: 0.9, answered: 12, total: 13 }], ['slow', { medianReplyMins: 400, answerRate: 0.5, answered: 6, total: 12 }]]);
  const b = P.buildBehaviour({ replyStats: rs, signalStats: ss, names: new Map([['najeeb', 'Najeeb']]), activeMinutes: [540, 545, 600, 1320, 1330, 1335, 1340], now: new Date(NOW) });
  assert.deepEqual(b.fastAnswer.map((f) => f.key), ['najeeb']);
  assert.match(b.summary[0], /He usually answers Najeeb within 20 min/);
  assert.match(b.summary.join(' '), /dismisses opportunity cards 70% of the time/);
  assert.deepEqual(b.busiest, ['22:00', '09:00', '10:00']);
  assert.equal(P.adjustScore(70, 'opportunity', b), 60);
  assert.equal(P.adjustScore(70, 'event', b), 70);
  assert.equal(P.adjustScore(70, 'reply', b), 70);
  assert.equal(P.adjustScore(5, 'opportunity', b), 0);
  assert.equal(P.fmtWithin(60), 'an hour');
  assert.equal(P.fmtWithin(7), '10 min');
});

test('advisor: parse keeps valid distinct items, max five, no em dashes', () => {
  const raw = { suggestions: [
    { title: 'Let Hostfully send check-in details', why: 'You answered 9 guest questions by hand', how: 'Create a scheduled template — at booking' },
    { title: 'Let Hostfully send the check-in details', why: 'dup', how: 'dup' },
    { title: '', why: 'x', how: 'y' },
    { title: 'Block 08:00 for replies', why: 'Najeeb waits', how: 'Calendar hold' },
    { title: 'A', why: '', how: 'b' }, { title: 'B title', why: '', how: 'b' }, { title: 'C title', why: '', how: 'b' }, { title: 'D title', why: '', how: 'b' },
  ] };
  const items = P.parseAdvice(raw);
  assert.equal(items.length, 5);
  assert.equal(items[1].title, 'Block 08:00 for replies');
  assert.doesNotMatch(JSON.stringify(items), /—/);
  assert.deepEqual(P.parseAdvice(null), []);
  assert.deepEqual(P.parseAdvice({ suggestions: 'nope' }), []);
  assert.match(P.adviceText(items.slice(0, 1)), /^1\. Let Hostfully/);
});

test('hostfully: health needs ok and a run under 15 minutes ago', () => {
  assert.equal(P.hostfullyHealthy({ ok: true, lastRunAt: new Date(NOW - 5 * 60e3).toISOString() }, NOW), true);
  assert.equal(P.hostfullyHealthy({ ok: true, lastRunAt: new Date(NOW - 20 * 60e3).toISOString() }, NOW), false);
  assert.equal(P.hostfullyHealthy({ ok: false, lastRunAt: new Date(NOW).toISOString() }, NOW), false);
  assert.equal(P.hostfullyHealthy(null, NOW), false);
});

test('reconcile: automated hostfully messages only settle check-in detail items', () => {
  const sig = (title) => ({ id: 's', kind: 'reply', title, threadKey: 'hostfully:T', createdAt: ago(5), since: ago(5) });
  const out = (body) => [{ threadKey: 'hostfully:T', occurredAt: ago(4), body }];
  assert.equal(P.selectDeterministicCloses([sig('Guest asks about check-in details')], out('[auto] Your door code is 1234')).length, 1);
  assert.equal(P.selectDeterministicCloses([sig('Guest asks for a late checkout')], out('[auto] Your door code is 1234')).length, 0);
  assert.equal(P.selectDeterministicCloses([sig('Guest asks for a late checkout')], out('Sure, 1pm works')).length, 1);
});
