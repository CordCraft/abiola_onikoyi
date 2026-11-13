import test from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../src/pure.js');

const R = { tz: 'Asia/Kuwait', quietStart: '22:30', quietEnd: '06:30', familyStart: '18:30', familyEnd: '21:30', maxPushesPerDay: 40, maxPushesPerHour: 8, familyThreshold: 70, quietThreshold: 80, alwaysOn: true };
const at = (h, m = 0) => h * 60 + m;

test('gate: always-on thresholds for family and quiet hours', () => {
  assert.equal(P.gateDecision(R, { nowMin: at(19), score: 69 }).ok, false);
  assert.equal(P.gateDecision(R, { nowMin: at(19), score: 70 }).ok, true);
  assert.equal(P.gateDecision(R, { nowMin: at(23), score: 79 }).reason, 'quiet hours');
  assert.equal(P.gateDecision(R, { nowMin: at(23), score: 80 }).ok, true);
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 44 }).ok, false);
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 60 }).ok, true);
});

test('gate: caps hold lower scores only', () => {
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 80, counts: { hour: 8, day: 1 } }).reason, 'hourly cap');
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 85, counts: { hour: 8, day: 1 } }).ok, true);
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 89, counts: { hour: 0, day: 40 } }).reason, 'daily cap');
  assert.equal(P.gateDecision(R, { nowMin: at(11), score: 90, counts: { hour: 0, day: 40 } }).ok, true);
});

test('rhythm: alwaysOn ignores the learned quiet start', () => {
  const defaults = { ...R };
  const learned = { firstActive: '07:00', lastActive: '20:00' };
  const on = P.buildRhythm(defaults, {}, learned);
  assert.equal(on.quietStart, '22:30');
  assert.equal(on.quietEnd, '07:00');
  const off = P.buildRhythm(defaults, { alwaysOn: false }, learned);
  assert.equal(off.quietStart, '20:00');
  const saved = P.buildRhythm(defaults, { alwaysOn: false, quietStart: '23:00' }, learned);
  assert.equal(saved.quietStart, '23:00');
});

test('digest timing', () => {
  const now = (h, m) => new Date(Date.UTC(2026, 10, 13, h - 3, m)); // Kuwait is UTC+3
  const due = (h, m, lastSentAt, waiting = 3) => P.digestDue({ now: now(h, m), nowMin: at(h, m), r: R, lastSentAt, waiting });
  assert.equal(due(12, 0, null, 0), false, 'nothing waiting');
  assert.equal(due(19, 0, null), false, 'not during family time');
  assert.equal(due(23, 0, null), false, 'not during quiet hours');
  assert.equal(due(21, 40, now(20, 0)), true, 'after family time');
  assert.equal(due(21, 40, now(21, 35)), false, 'already sent since family time ended');
  assert.equal(due(6, 40, new Date(now(21, 40).getTime() - 864e5)), true, 'after quiet hours');
  assert.equal(due(12, 0, now(10, 30)), false, 'under two hours');
  assert.equal(due(12, 31, now(10, 30)), true, 'two hours on');
  assert.equal(P.digestText({ replies: 4, other: 1, closed: 2 }), '4 replies owed, 1 other item waiting, 2 done by Jarvis');
});

test('title similarity and duplicate groups', () => {
  assert.ok(P.titleSimilarity('Send PEL doc to Taslim', 'Send the PEL doc to Taslim by Friday') >= 0.55);
  assert.ok(P.titleSimilarity('Send invoice to client', 'Send PEL doc to Taslim') < 0.55);
  assert.equal(P.titleSimilarity('', 'x'), 0);
  assert.equal(P.DUPLICATE_THRESHOLD, 0.7);
  const tasks = [
    { id: 'a', title: 'Deepcrest HoT review', createdAt: '2026-11-01', priority: 'medium' },
    { id: 'b', title: 'Review Deepcrest HoT', createdAt: '2026-11-03', priority: 'high' },
    { id: 'c', title: 'Buy milk', createdAt: '2026-11-02', priority: 'low' },
    { id: 'd', title: 'Call plumber', createdAt: '2026-11-02', priority: 'low', threadKey: 't1' },
    { id: 'e', title: 'Call plumber about the tap', createdAt: '2026-11-04', priority: 'low', threadKey: 't1' },
  ];
  const groups = P.findDuplicateGroups(tasks);
  assert.equal(groups.length, 2);
  const g1 = groups.find((g) => g.keep.id === 'a');
  assert.deepEqual(g1.drop.map((d) => d.id), ['b'], 'oldest kept');
  assert.deepEqual(groups.find((g) => g.keep.id === 'd').drop.map((d) => d.id), ['e'], 'same thread with a similar title merges');
});

test('duplicates: names and numbers block, same thread needs 0.4, no transitive chains', () => {
  const t = (id, title, extra = {}) => ({ id, title, createdAt: `2026-11-0${id.charCodeAt(0) - 96}`, priority: 'medium', ...extra });
  assert.equal(P.isDuplicateTask(t('a', 'Send invoice to Taslim today'), t('b', 'Send invoice to Bola today')), false, 'different name');
  assert.equal(P.isDuplicateTask(t('a', 'Pay invoice 2041 this week'), t('b', 'Pay invoice 2042 this week')), false, 'different number');
  assert.equal(P.isDuplicateTask(t('a', 'Send the PEL doc to Taslim'), t('b', 'Send PEL doc to Taslim')), true, 'same words');
  assert.equal(P.isDuplicateTask(t('a', 'Call plumber', { threadKey: 'x' }), t('b', 'Fix the tap', { threadKey: 'x' })), false, 'same thread but unrelated titles');
  assert.equal(P.isDuplicateTask(t('a', 'Call plumber', { threadKey: 'x' }), t('b', 'Call plumber about tap', { threadKey: 'x' })), true);
  // a ~ b ~ c in a chain, but a !~ c: c must not be pulled into a's group
  const chain = [t('a', 'alpha beta gamma delta epsilon zeta'), t('b', 'beta gamma delta epsilon zeta eta'), t('c', 'gamma delta epsilon zeta eta theta')];
  assert.ok(P.titleSimilarity(chain[0].title, chain[1].title) >= 0.7 && P.titleSimilarity(chain[1].title, chain[2].title) >= 0.7 && P.titleSimilarity(chain[0].title, chain[2].title) < 0.7);
  const groups = P.findDuplicateGroups(chain);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].drop.map((d) => d.id), ['b']);
});

test('merge target selection: open signals only', () => {
  const row = (id, status, updatedAt) => ({ id, status, updatedAt });
  assert.equal(P.selectMergeTarget([]), null);
  assert.equal(P.selectMergeTarget([row('a', 'new', '2026-11-12'), row('b', 'pushed', '2026-11-13')]).id, 'b');
  assert.equal(P.selectMergeTarget([row('a', 'applied', '2026-11-10'), row('b', 'new', '2026-11-01')]).id, 'b', 'open beats applied');
  assert.equal(P.selectMergeTarget([row('a', 'applied', '2026-11-13')]), null, 'applied is never merged into');
  assert.equal(P.selectMergeTarget([row('a', 'resolved', '2026-11-13'), row('b', 'dismissed', '2026-11-13'), row('c', 'expired', '2026-11-13')]), null);
});

test('deterministic close selection', () => {
  const sigs = [
    { id: 's1', kind: 'reply', threadKey: 'wa:1', createdAt: '2026-11-13T10:00:00Z' },
    { id: 's2', kind: 'reply', threadKey: 'wa:2', createdAt: '2026-11-13T10:00:00Z', since: '2026-11-13T09:00:00Z' },
    { id: 's3', kind: 'task', threadKey: 'wa:1', createdAt: '2026-11-13T10:00:00Z' },
    { id: 's4', kind: 'followup', threadKey: 'wa:3', createdAt: '2026-11-13T10:00:00Z' },
    { id: 's5', kind: 'reply', threadKey: null, createdAt: '2026-11-13T10:00:00Z' },
  ];
  const out = [
    { threadKey: 'wa:1', occurredAt: '2026-11-13T11:00:00Z', body: 'a later full answer' },
    { threadKey: 'wa:1', occurredAt: '2026-11-13T10:30:00Z', body: 'first proper answer' },
    { threadKey: 'wa:2', occurredAt: '2026-11-13T09:30:00Z', body: 'before creation, after the message' },
    { threadKey: 'wa:3', occurredAt: '2026-11-13T09:00:00Z', body: 'too early for this one' },
  ];
  const r = P.selectDeterministicCloses(sigs, out);
  assert.deepEqual(r.map((x) => x.signal.id), ['s1', 's2']);
  assert.equal(r[0].outgoing.body, 'first proper answer');
});

test('deterministic close: ack-only, short, group, own-promise and reopened', () => {
  const base = { createdAt: '2026-11-13T10:00:00Z' };
  const at = '2026-11-13T11:00:00Z';
  const one = (sig, body, threadKey = sig.threadKey) => P.selectDeterministicCloses([sig], [{ threadKey, occurredAt: at, body }]);
  const reply = { id: 'r', kind: 'reply', threadKey: 'wa:1', ...base };
  assert.equal(one(reply, 'ok thanks').length, 0, 'ack only');
  assert.equal(one(reply, 'Sent it.').length, 0, 'under 12 characters');
  assert.equal(one(reply, 'I sent the invoice just now').length, 1);
  const group = { id: 'g', kind: 'reply', threadKey: 'wa:1203@g.us', ...base };
  assert.equal(one(group, 'I sent the invoice just now').length, 0, 'whatsapp groups go to the model');
  const own = { id: 'f', kind: 'followup', threadKey: 'wa:2', ownPromise: true, ...base };
  assert.equal(one(own, 'I sent the invoice just now').length, 0, 'his own promise goes to the model');
  assert.equal(one({ ...own, ownPromise: false }, 'I sent the invoice just now').length, 1, 'a followup on someone else can close');
  const open = (reopenedAt, occurredAt) => P.selectDeterministicCloses([reply], [{ threadKey: 'wa:1', occurredAt, body: 'I sent the invoice just now' }], { reopenedAt: () => reopenedAt });
  assert.equal(open('2026-11-13T12:00:00Z', at).length, 0, 'evidence older than the undo does not close it again');
  assert.equal(open('2026-11-13T12:00:00Z', '2026-11-13T13:00:00Z').length, 1, 'newer evidence does');
  const auto = { id: 'c', kind: 'reply', threadKey: 'hostfully:1', title: 'Guest asks for the door code', ...base };
  assert.equal(P.selectDeterministicCloses([auto], [{ threadKey: 'hostfully:1', occurredAt: at, body: '[auto] The door code is 4411 and wifi is Stay2026' }]).length, 1, 'auto message still settles a check-in item');
  assert.equal(P.selectDeterministicCloses([auto], [{ threadKey: 'hostfully:1', occurredAt: at, body: '[auto] ok' }]).length, 0);
});

test('stalled tasks: overdue or recently active, two nudges per task until it changes', () => {
  const NOW = Date.parse('2026-11-13T12:00:00Z');
  const task = (id, idle, extra = {}) => ({ id, status: 'todo', updatedAt: new Date(NOW - idle * 864e5), dueDate: null, ...extra });
  const tasks = [task('fresh', 5), task('old', 30), task('oldOverdue', 30, { dueDate: new Date(NOW - 2 * 864e5) })];
  assert.deepEqual(P.selectStalledTasks(tasks, [], { now: NOW }).map((t) => t.id).sort(), ['fresh', 'oldOverdue']);
  const n = (id, daysAgo, status = 'dismissed') => ({ threadKey: `task:${id}`, status, createdAt: new Date(NOW - daysAgo * 864e5) });
  assert.equal(P.selectStalledTasks([task('x', 10)], [n('x', 4), n('x', 8)], { now: NOW }).length, 0, 'two already sent');
  assert.equal(P.selectStalledTasks([task('x', 10)], [n('x', 4)], { now: NOW }).length, 1, 'one sent, a second allowed');
  assert.equal(P.selectStalledTasks([task('x', 3)], [n('x', 4), n('x', 8)], { now: NOW }).length, 1, 'task changed since: counter restarts');
});

test('digest: only when the waiting set changed or 6 hours passed', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const sent = new Date(now - 3 * 3600e3).toISOString();
  assert.equal(P.digestChanged({ hash: 'a', lastHash: 'a', lastSentAt: sent, now }), false);
  assert.equal(P.digestChanged({ hash: 'b', lastHash: 'a', lastSentAt: sent, now }), true);
  assert.equal(P.digestChanged({ hash: 'a', lastHash: 'a', lastSentAt: new Date(now - 7 * 3600e3).toISOString(), now }), true);
  assert.equal(P.digestChanged({ hash: 'a', lastHash: null, lastSentAt: null, now }), true);
});

test('model closes: only offered ids above the confidence floor', () => {
  const items = [{ id: 'a', type: 'signal' }, { id: 'b', type: 'task' }];
  const res = { closes: [
    { id: 'a', type: 'signal', confidence: 0.9, evidence: 'sent' },
    { id: 'b', type: 'task', confidence: 0.7, evidence: 'maybe' },
    { id: 'zzz', type: 'signal', confidence: 0.99, evidence: 'invented' },
    { id: 'a', type: 'task', confidence: 0.99, evidence: 'wrong type' },
    { id: 'a', type: 'signal', confidence: 0.95, evidence: 'dupe' },
  ] };
  const acc = P.acceptCloses(res, items);
  assert.deepEqual(acc.map((c) => c.id), ['a']);
  assert.equal(P.acceptCloses({ closes: [{ id: 'b', type: 'task', confidence: 0.75, evidence: 'x' }] }, items).length, 1);
});

test('people keys for outgoing messages', () => {
  assert.deepEqual(P.personKeysForOutgoing({ threadKey: 'wa:2348000000000@s.whatsapp.net' }), ['2348000000000']);
  assert.deepEqual(P.personKeysForOutgoing({ threadKey: 'wa:1203@g.us' }), []);
  assert.deepEqual(P.personKeysForOutgoing({ threadKey: 'gmail:me@x.com:T1', recipients: 'Bob <Bob@Client.com>, cfo@client.com' }), ['bob@client.com', 'cfo@client.com']);
});
