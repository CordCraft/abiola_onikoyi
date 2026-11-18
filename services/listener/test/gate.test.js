import test from 'node:test';
import assert from 'node:assert/strict';
const { prefilterReason, mustKeep, isUrgent, shouldTriageNow, makeLimiter } = await import('../src/gate.js');

const wa = (body, extra = {}) => ({ source: 'whatsapp', direction: 'in', body, isGroup: false, sender: '234800', ...extra });

test('prefilter drops messages that cannot matter', () => {
  assert.equal(prefilterReason(wa('ok')), 'too-short');
  assert.equal(prefilterReason(wa('Thanks!! 🙏')), 'acknowledgement');
  assert.equal(prefilterReason(wa('😂😂😂')), 'acknowledgement');
  assert.equal(prefilterReason(wa('[photo, no caption]')), 'media-no-caption');
  assert.equal(prefilterReason(wa('Your verification code is 482913')), 'otp');
  assert.equal(prefilterReason(wa('lol that is funny', { isGroup: true })), 'group-chatter');
  assert.equal(prefilterReason({ source: 'gmail', direction: 'in', sender: 'no-reply@shop.com', body: 'Your weekly digest is here with new arrivals and offers for you.' }), 'automated-sender');
});

test('prefilter never drops anything that may need action', () => {
  assert.equal(prefilterReason(wa('Can we meet Tuesday 10am?')), null);
  assert.equal(prefilterReason(wa('Please send the invoice today')), null);
  assert.equal(prefilterReason(wa('ok', { isGroup: true, direction: 'out' })), 'too-short'); // pure ack either way
  assert.equal(prefilterReason(wa('Pay $500 tomorrow', { isGroup: true })), null);
  assert.equal(prefilterReason({ source: 'outlook', direction: 'in', sender: 'noreply@airline.com', subject: 'Your flight itinerary', body: 'Booking confirmed for your trip to Kigali on Monday.' }), null);
  assert.equal(prefilterReason(wa('Can you call me when you land? I need your decision on the school fees')), null);
  assert.equal(prefilterReason(wa('I will send it', { direction: 'out' })), null);
});

test('mustKeep bypasses the cheap gate for actionable text and important people', () => {
  assert.equal(mustKeep(wa('see you at 9:30'), new Set()), true);
  assert.equal(mustKeep(wa('how are you doing my friend'), new Set(['234800'])), true);
  assert.equal(mustKeep(wa('how are you doing my friend'), new Set()), false);
  assert.equal(mustKeep(wa('hello', { isGroup: true }), new Set(['234800'])), false);
  assert.equal(mustKeep(wa('x', { subject: 'Voice note' }), new Set()), true);
});

test('urgent means a direct message from an important person', () => {
  assert.equal(isUrgent(wa('hi'), new Set(['234800'])), true);
  assert.equal(isUrgent(wa('hi', { isGroup: true }), new Set(['234800'])), false);
  assert.equal(isUrgent(wa('hi', { direction: 'out' }), new Set(['234800'])), false);
});

test('batches wait for a minimum size or a maximum age', () => {
  const base = { minBatch: 6, maxWaitMs: 300000, urgent: false };
  assert.equal(shouldTriageNow({ ...base, count: 0, oldestAgeMs: 1e9 }), false);
  assert.equal(shouldTriageNow({ ...base, count: 2, oldestAgeMs: 60000 }), false);
  assert.equal(shouldTriageNow({ ...base, count: 2, oldestAgeMs: 300000 }), true);
  assert.equal(shouldTriageNow({ ...base, count: 6, oldestAgeMs: 0 }), true);
  assert.equal(shouldTriageNow({ ...base, count: 1, oldestAgeMs: 0, urgent: true }), true);
});

test('hourly limiter caps calls and recovers', () => {
  let t = 0;
  const l = makeLimiter(2, () => t);
  assert.equal(l.allow(), true);
  l.record(); l.record();
  assert.equal(l.allow(), false);
  t = 3600e3 + 1;
  assert.equal(l.allow(), true);
});
