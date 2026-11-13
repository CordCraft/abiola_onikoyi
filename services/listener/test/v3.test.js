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
  assert.ok(P.titleSimilarity('Saudi Eagles water', 'Saudi Eagles water delivery payment') >= 0.55);
  assert.ok(P.titleSimilarity('Send invoice to client', 'Send PEL doc to Taslim') < 0.55);
  assert.equal(P.titleSimilarity('', 'x'), 0);
  const tasks = [
    { id: 'a', title: 'Deepcrest HoT review', createdAt: '2026-11-01', priority: 'medium' },
    { id: 'b', title: 'Review Deepcrest HoT', createdAt: '2026-11-03', priority: 'high' },
    { id: 'c', title: 'Buy milk', createdAt: '2026-11-02', priority: 'low' },
    { id: 'd', title: 'Call plumber', createdAt: '2026-11-02', priority: 'low', threadKey: 't1' },
    { id: 'e', title: 'Fix the tap', createdAt: '2026-11-04', priority: 'low', threadKey: 't1' },
  ];
  const groups = P.findDuplicateGroups(tasks);
  assert.equal(groups.length, 2);
  const g1 = groups.find((g) => g.keep.id === 'a');
  assert.deepEqual(g1.drop.map((d) => d.id), ['b'], 'oldest kept');
  assert.deepEqual(groups.find((g) => g.keep.id === 'd').drop.map((d) => d.id), ['e'], 'same thread merges');
});

test('merge target selection', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const row = (id, status, updatedAt, decidedAt) => ({ id, status, updatedAt, decidedAt });
  assert.equal(P.selectMergeTarget([], now), null);
  assert.equal(P.selectMergeTarget([row('a', 'new', '2026-11-12'), row('b', 'pushed', '2026-11-13')], now).id, 'b');
  assert.equal(P.selectMergeTarget([row('a', 'applied', '2026-11-10', '2026-11-10'), row('b', 'new', '2026-11-01')], now).id, 'b', 'open beats applied');
  assert.equal(P.selectMergeTarget([row('a', 'applied', '2026-11-10', '2026-11-10')], now).id, 'a');
  assert.equal(P.selectMergeTarget([row('a', 'applied', '2026-11-01', '2026-11-01')], now), null, 'applied too long ago');
  assert.equal(P.selectMergeTarget([row('a', 'resolved', '2026-11-13'), row('b', 'dismissed', '2026-11-13'), row('c', 'expired', '2026-11-13')], now), null);
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
    { threadKey: 'wa:1', occurredAt: '2026-11-13T11:00:00Z', body: 'later' },
    { threadKey: 'wa:1', occurredAt: '2026-11-13T10:30:00Z', body: 'first' },
    { threadKey: 'wa:2', occurredAt: '2026-11-13T09:30:00Z', body: 'before creation, after the message' },
    { threadKey: 'wa:3', occurredAt: '2026-11-13T09:00:00Z', body: 'too early' },
  ];
  const r = P.selectDeterministicCloses(sigs, out);
  assert.deepEqual(r.map((x) => x.signal.id), ['s1', 's2']);
  assert.equal(r[0].outgoing.body, 'first');
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
