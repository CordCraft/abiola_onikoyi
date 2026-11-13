import test from 'node:test';
import assert from 'node:assert/strict';
process.env.JARVIS_ENCRYPTION_KEY = 'test-key-123';
process.env.DATABASE_URL = 'postgres://x:y@localhost:1/none';
const { encrypt, decrypt } = await import('../src/crypto.js');
const util = await import('../src/util.js');

test('token encryption round-trips and is non-deterministic', () => {
  const a = encrypt('ya29.secret');
  assert.notEqual(a, encrypt('ya29.secret'));
  assert.equal(decrypt(a), 'ya29.secret');
});

test('time helpers in Kuwait', () => {
  const d = new Date('2026-11-09T05:30:00Z'); // 08:30 in Kuwait
  assert.equal(util.minutesIn('Asia/Kuwait', d), 8 * 60 + 30);
  assert.equal(util.tzOffsetMinutes('Asia/Kuwait', d), 180);
  assert.equal(util.dateKeyIn('Asia/Kuwait', d), '2026-11-09');
  assert.equal(util.weekdayIn('Asia/Kuwait', d), 'Monday');
  assert.equal(util.parseHm('18:30', 0), 1110);
  assert.equal(util.hm(1110), '18:30');
});

test('email cleanup', () => {
  assert.equal(util.htmlToText('<p>Hi&nbsp;there</p><br>Bye'), 'Hi there\n\nBye');
  const reply = 'Sounds good, Thursday 10am works for me.\n\nOn Mon, 9 Nov 2026 at 09:00, Abiola wrote:\n> old text';
  assert.equal(util.stripQuoted(reply), 'Sounds good, Thursday 10am works for me.');
});

test('every module imports', async () => {
  for (const m of ['config', 'db', 'accounts', 'gmail', 'outlook', 'calendar', 'context', 'llm', 'push', 'jobs', 'brain', 'executor', 'planner', 'whatsapp', 'voice', 'pure', 'reconcile', 'digest']) {
    await import(`../src/${m}.js`);
  }
});
