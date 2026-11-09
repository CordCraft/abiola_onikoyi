// End-to-end check of the listener's SQL against a real Postgres with the full schema
// (run against an embedded test database, never production). The model is faked.
// Usage: DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres DB_POOL_MAX=1 node test/integration.mjs
import assert from 'node:assert/strict';

process.env.JARVIS_ENCRYPTION_KEY ||= 'test';
process.env.ANTHROPIC_API_KEY ||= 'test';
process.env.DATA_DIR ||= './.data';

const { ensureTables, q, one, pool } = await import('../src/db.js');
const { storeInbound } = await import('../src/accounts.js');
const { triageOnce } = await import('../src/brain.js');
const { runJobs } = await import('../src/executor.js');
const { morningPlan, learnRhythm, housekeeping, plannerTick } = await import('../src/planner.js');
const { flushHeld, mayInterrupt } = await import('../src/push.js');

await ensureTables();
await ensureTables(); // idempotent

const now = new Date();
const waId = await storeInbound({ source: 'whatsapp', externalId: 'wa:T1:2348000000000@s.whatsapp.net', threadKey: 'wa:2348000000000@s.whatsapp.net', sender: '2348000000000', senderName: 'Taslim', body: 'Can we meet Tuesday 10am at your office to close the PEL bid? Also please send the doc by Friday.', occurredAt: now });
const mailId = await storeInbound({ source: 'gmail', connectionId: null, externalId: 'gmail:me@x.com:M1', threadKey: 'gmail:me@x.com:TH1', sender: 'cfo@client.com', senderName: 'Client CFO', subject: 'Invoice 2041', body: 'Hi Abiola, can you confirm the invoice amount before we pay?', occurredAt: now });
const dupe = await storeInbound({ source: 'whatsapp', externalId: 'wa:T1:2348000000000@s.whatsapp.net', body: 'dupe', occurredAt: now });
assert.ok(waId && mailId, 'inbound stored');
assert.equal(dupe, null, 'duplicate externalId ignored');
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:OLD', body: 'old', occurredAt: new Date(Date.now() - 10 * 864e5) });

globalThis.__jarvisFakeStructured = async ({ user, schema }) => {
  if (schema.required.includes('items')) {
    assert.match(user, /Taslim/);
    return {
      items: [
        { inbound_ids: [waId], kind: 'event', title: 'Meet Taslim Tuesday 10:00 on PEL bid', detail: 'At your office.', why: 'PEL venture', score: 82, project_id: '', same_as_signal_id: '', due_at: '', person: { key: '2348000000000', name: 'Taslim', relation: 'partner', org: 'Milsat' }, calendar: { title: 'Taslim: PEL bid', start: '2026-11-10T10:00:00+03:00', end: '2026-11-10T11:00:00+03:00', all_day: false, location: 'Office', purpose: 'work', confirmed: true }, task: { title: '', due_date: '', priority: 'medium' }, reply: { text: '' } },
        { inbound_ids: [waId], kind: 'task', title: 'Send Taslim the PEL doc by Friday', detail: '', why: 'PEL venture', score: 70, project_id: '', same_as_signal_id: '', due_at: '', person: { key: '2348000000000', name: 'Taslim', relation: 'partner', org: '' }, calendar: { title: '', start: '', end: '', all_day: false, location: '', purpose: 'work', confirmed: false }, task: { title: 'Send PEL doc to Taslim', due_date: '2026-11-13', priority: 'high' }, reply: { text: '' } },
        { inbound_ids: [mailId], kind: 'reply', title: 'Client CFO wants the invoice confirmed', detail: 'Payment waits on you.', why: 'Revenue', score: 88, project_id: 'not-a-real-project', same_as_signal_id: '', due_at: '', person: { key: 'cfo@client.com', name: 'Client CFO', relation: 'client', org: 'Client' }, calendar: { title: '', start: '', end: '', all_day: false, location: '', purpose: 'work', confirmed: false }, task: { title: '', due_date: '', priority: 'medium' }, reply: { text: 'Confirmed, the amount on invoice 2041 is correct. Thank you.' } },
      ],
    };
  }
  return {
    summary: 'Close the PEL bid with Taslim, confirm the client invoice, protect family time.',
    blocks: [{ start: '09:00', end: '10:00', title: 'Deep work: PEL doc', kind: 'focus', signal_id: '', existing_event: false }, { start: '18:30', end: '21:30', title: 'Dinner and homework', kind: 'family', signal_id: '', existing_event: false }],
    top_moves: [{ title: 'Send PEL doc', why: 'Bid closes Tuesday' }, { title: 'Confirm invoice 2041', why: 'Cash in' }, { title: 'Prep Taslim meeting', why: 'PEL' }],
    stop_at: '18:00',
    family_note: 'Home for dinner.',
  };
};

const n = await triageOnce();
assert.equal(n, 3, 'three inbound seen (one old)');
const sigs = await q(`SELECT kind, autonomy, status, "projectId", action FROM "JarvisSignal" ORDER BY score DESC`);
assert.equal(sigs.length, 3);
assert.deepEqual(sigs.map((s) => s.kind), ['reply', 'event', 'task']);
assert.equal(sigs.find((s) => s.kind === 'reply').autonomy, 'ask');
assert.equal(sigs.find((s) => s.kind === 'reply').projectId, null, 'unknown project ids are dropped');
assert.equal(sigs.find((s) => s.kind === 'reply').action.payload.channel, 'gmail');
assert.equal(sigs.find((s) => s.kind === 'event').autonomy, 'auto');
const untriaged = await one(`SELECT count(*)::int AS n FROM "JarvisInbound" WHERE "triagedAt" IS NULL`);
assert.equal(untriaged.n, 0);
const old = await one(`SELECT triage FROM "JarvisInbound" WHERE "externalId" = 'gmail:me@x.com:OLD'`);
assert.equal(old.triage.skipped, 'old');
const person = await one(`SELECT * FROM "JarvisPerson" WHERE key = '2348000000000'`);
assert.equal(person.name, 'Taslim');
assert.equal(person.openLoops, 1);
const jobs = await q(`SELECT kind, status FROM "JarvisJob"`);
assert.equal(jobs.length, 2, 'auto event + auto task queued');

await runJobs();
const task = await one(`SELECT * FROM "JarvisTask" WHERE title = 'Send PEL doc to Taslim'`);
assert.ok(task, 'auto task created');
assert.equal(task.priority, 'high');
const eventSig = await one(`SELECT status, result FROM "JarvisSignal" WHERE kind = 'event'`);
assert.equal(eventSig.status, 'failed', 'no calendar connected, so the event fails cleanly');
assert.match(eventSig.result.error, /no calendar connected/);

// Undo the auto task through the queue, the way the site does.
const taskSig = await one(`SELECT id FROM "JarvisSignal" WHERE kind = 'task'`);
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('u1', 'undo_signal', $1)`, [JSON.stringify({ signalId: taskSig.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [taskSig.id])).status, 'undone');
assert.equal(await one(`SELECT id FROM "JarvisTask" WHERE id = $1`, [task.id]), null, 'task removed on undo');

// Planner.
const plan = await morningPlan({ force: true });
const planSig = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [plan.id]);
assert.equal(planSig.kind, 'plan');
assert.equal(planSig.action.payload.blocks.length, 2);
const note = await one(`SELECT body FROM "JarvisNote" WHERE body LIKE 'Morning briefing:%'`);
assert.ok(note, 'briefing note written');

await mayInterrupt(50);
await flushHeld();
await learnRhythm();
await housekeeping();
await plannerTick();

console.log('INTEGRATION OK');
await pool.end();
process.exit(0);
