import test from 'node:test';
import assert from 'node:assert/strict';
const { normWords, jaccard, higherPriority, effectiveScore, effectiveScoreSql } = await import('../src/util.js');

test('task titles that are the same work dedupe at 0.55', () => {
  assert.deepEqual([...normWords('Review the Deepcrest HoT!')], ['review', 'deepcrest', 'hot']);
  assert.equal(jaccard('Review Deepcrest HoT', 'Review Deepcrest HoT'), 1);
  assert.ok(jaccard('Review Deepcrest HoT', 'Review the Deepcrest HoT draft') >= 0.55);
  assert.ok(jaccard('Review Deepcrest HoT', 'Pay school fees') < 0.55);
  assert.equal(jaccard('', 'anything'), 0);
});

test('priority keeps the highest', () => {
  assert.equal(higherPriority('low', 'high'), 'high');
  assert.equal(higherPriority('high', 'medium'), 'high');
  assert.equal(higherPriority('medium', undefined), 'medium');
});

test('signals halve every 36 hours', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  assert.equal(effectiveScore(80, new Date(now), now), 80);
  assert.equal(Math.round(effectiveScore(80, new Date(now - 36 * 3600e3), now)), 40);
  assert.match(effectiveScoreSql('s'), /s\.score \* power\(0\.5/);
});
