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
const { reconcileOnce, createCleanupCard, expireSignals } = await import('../src/reconcile.js');
const { digestTick, waitingCounts } = await import('../src/digest.js');
const { eveningCloseout } = await import('../src/planner.js');

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

// ---------------- v3: loop closing ----------------
const { createTask } = await import('../src/executor.js');
const baseFake = globalThis.__jarvisFakeStructured;
const noCal = { title: '', start: '', end: '', all_day: false, location: '', purpose: 'work', confirmed: false };
const noTask = { title: '', due_date: '', priority: 'medium' };
let tripleItems = [];
let closeIds = [];
let closeCalls = 0;
globalThis.__jarvisFakeStructured = async (args) => {
  if (args.schema.required.includes('closes')) {
    closeCalls += 1;
    return { closes: closeIds.map((id) => ({ id, type: 'task', confidence: 0.9, evidence: 'You sent the agreement draft to the group' })).concat([{ id: 'invented-id', type: 'task', confidence: 0.99, evidence: 'not offered' }]) };
  }
  if (args.schema.required.includes('items')) return { items: tripleItems };
  return baseFake(args);
};
const t0 = new Date();

// Merge: a second email on the same thread folds into the open reply card, with an expiry.
const replyBefore = await one(`SELECT id, "inboundIds", "threadKey" FROM "JarvisSignal" WHERE kind = 'reply'`);
assert.equal(replyBefore.threadKey, 'gmail:me@x.com:TH1', 'signals carry the thread key');
const more = await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:M2', threadKey: 'gmail:me@x.com:TH1', sender: 'cfo@client.com', senderName: 'Client CFO', subject: 'Re: Invoice 2041', body: 'Any update on the invoice?', occurredAt: t0 });
const soon = new Date(Date.now() + 2 * 864e5).toISOString();
tripleItems = [{ inbound_ids: [more], kind: 'reply', title: 'Client CFO chasing the invoice', detail: 'Second chase.', why: 'Revenue', score: 90, project_id: '', same_as_signal_id: '', due_at: '', expires_at: soon, person: { key: 'cfo@client.com', name: 'Client CFO', relation: 'client', org: 'Client' }, calendar: noCal, task: noTask, reply: { text: 'Confirmed.' } }];
await triageOnce();
const replies = await q(`SELECT id, score, "inboundIds", "expiresAt" FROM "JarvisSignal" WHERE kind = 'reply'`);
assert.equal(replies.length, 1, 'merged, not duplicated');
assert.equal(replies[0].id, replyBefore.id);
assert.equal(replies[0].inboundIds.length, 2);
assert.equal(replies[0].score, 90);
assert.ok(replies[0].expiresAt, 'expires_at stored');
tripleItems = [];

// createTask dedupe: title similarity, then thread key.
const t1 = await createTask({ title: 'Prepare Q4 board pack', threadKey: 'th-board' });
const t2 = await createTask({ title: 'Q4 board pack prepare please' });
assert.equal(t2.taskId, t1.taskId);
assert.equal(t2.linked, true);
const t3 = await createTask({ title: 'Totally different words here', threadKey: 'th-board' });
assert.equal(t3.taskId, t1.taskId, 'same thread key links');
const t4 = await createTask({ title: 'Book flight to Dhahran' });
assert.notEqual(t4.taskId, t1.taskId);

// Fixtures for the clean-up: duplicates, a task done by an outgoing message, a task linked to the reply card.
const ins = async (id, title, extra = {}) => q(`INSERT INTO "JarvisTask" (id, title, status, priority, "createdAt", "updatedAt", "sourceSignalId") VALUES ($1,$2,'todo','medium', now() - ($3 || ' hours')::interval, now(), $4)`, [id, title, String(extra.age || 1), extra.sig || null]);
await ins('w1', 'Saudi Eagles water', { age: 50 });
await ins('w2', 'Saudi Eagles water delivery', { age: 40 });
await ins('w3', 'Pay Saudi Eagles water', { age: 30 });
await ins('agr', 'Send draft agreement to Upstream group');
await ins('lnk', 'Confirm invoice 2041 amount', { sig: replyBefore.id });
closeIds = ['agr'];
const person0 = (await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops;

// The owner answered the CFO (outgoing, after the inbound), not yet triaged.
const outId = await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:SENT1', threadKey: 'gmail:me@x.com:TH1', direction: 'out', sender: 'me@x.com', recipients: 'Client CFO <cfo@client.com>', subject: 'Re: Invoice 2041', body: 'Confirmed, the amount on invoice 2041 is correct.', occurredAt: new Date(Date.now() + 60e3) });
assert.ok(outId);

// Before the clean-up is decided, reconcile does nothing.
assert.deepEqual(await reconcileOnce({}), { skipped: 'awaiting the one-time clean-up proposal' });

const card = await createCleanupCard();
assert.ok(card, 'clean-up card created');
assert.equal(await createCleanupCard(), null, 'first-run guard');
const cardRow = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [card.id]);
assert.equal(cardRow.kind, 'plan');
assert.equal(cardRow.action.type, 'cleanup');
assert.match(cardRow.title, /^Clean-up: I can close 2 items you've already done and merge 2 duplicates$/);
const payload = cardRow.action.payload;
assert.deepEqual(payload.close.map((c) => `${c.type}:${c.id}`).sort(), [`signal:${replyBefore.id}`, 'task:agr'].sort());
assert.equal(payload.merge.length, 1);
assert.equal(payload.merge[0].keep.id, 'w1');
assert.deepEqual(payload.merge[0].drop.map((d) => d.id).sort(), ['w2', 'w3']);
await housekeeping();
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [card.id])).status, 'dismissed', 'housekeeping keeps the clean-up card');

// While the card is open, old items are not closed behind the owner's back.
const guarded = await reconcileOnce({});
assert.equal(guarded.deterministic, 0);
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'agr'`)).status, 'todo');

// Approve: Do it.
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl1', 'apply_signal', $1)`, [JSON.stringify({ signalId: card.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [card.id])).status, 'applied');
const rs = await one(`SELECT status, "resolvedBy" FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id]);
assert.equal(rs.status, 'resolved');
assert.equal(rs.resolvedBy, 'reconcile');
assert.equal((await one(`SELECT "closedBy" FROM "JarvisTask" WHERE id = 'agr'`)).closedBy, 'cleanup');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'lnk'`)).status, 'done', 'task linked to the signal closes with it');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'w2'`)).status, 'done');
assert.match((await one(`SELECT "closeNote" FROM "JarvisTask" WHERE id = 'w3'`)).closeNote, /Merged into: Saudi Eagles water/);
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'w1'`)).status, 'todo', 'the kept task stays open');
assert.equal((await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops, person0 - 1);
assert.equal((await one(`SELECT count(*)::int AS n FROM "JarvisLedger" WHERE "signalId" = $1`, [replyBefore.id])).n, 1);

// Undo the whole clean-up.
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl2', 'undo_signal', $1)`, [JSON.stringify({ signalId: card.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [card.id])).status, 'undone');
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved');
for (const id of ['agr', 'lnk', 'w2', 'w3']) assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = $1`, [id])).status, 'todo', `${id} reopened`);
assert.equal((await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops, person0);
assert.equal((await one(`SELECT count(*)::int AS n FROM "JarvisLedger" WHERE "signalId" = $1`, [replyBefore.id])).n, 0, 'ledger row removed on undo');

// Deterministic close through the triage hook: triaging the outgoing mail closes the reply and its task.
closeIds = [];
closeCalls = 0;
await triageOnce();
const closedSig = await one(`SELECT status, "resolvedBy", resolution FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id]);
assert.equal(closedSig.status, 'resolved');
assert.equal(closedSig.resolvedBy, 'reply');
assert.match(closedSig.resolution, /Confirmed, the amount/);
const lnk = await one(`SELECT status, "closedBy" FROM "JarvisTask" WHERE id = 'lnk'`);
assert.equal(lnk.status, 'done');
assert.equal(lnk.closedBy, 'reply');
const led = await one(`SELECT * FROM "JarvisLedger" WHERE "signalId" = $1`, [replyBefore.id]);
assert.equal(led.closedBy, 'reply');
assert.equal(led.taskId, 'lnk');
assert.ok(closeCalls >= 1, 'model close pass ran after a batch with outgoing mail');
assert.equal((await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops, person0 - 1);
assert.ok((await one(`SELECT "lastOutboundAt" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).lastOutboundAt, 'lastOutboundAt written for outgoing mail');
// Undo of a reply close brings it back.
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl3', 'undo_signal', $1)`, [JSON.stringify({ signalId: replyBefore.id })]);
await runJobs();
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'lnk'`)).status, 'todo');
await reconcileOnce({});
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved');

// Model close of a task from messages (accepts the offered id, ignores the invented one).
closeIds = ['agr'];
const m = await reconcileOnce({ sinceHours: 24 });
assert.equal(m.model, 1);
assert.equal((await one(`SELECT "closedBy" FROM "JarvisTask" WHERE id = 'agr'`)).closedBy, 'reconcile');
assert.ok(await one(`SELECT id FROM "JarvisLedger" WHERE "taskId" = 'agr' AND "closedBy" = 'reconcile'`));
closeIds = [];

// Expiry and stale-task nudges.
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "expiresAt", "updatedAt") VALUES ('exp1','event','Guest checks out','new', now() - interval '1 hour', now())`);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "updatedAt") VALUES ('stale1','reply','Old question','pushed', now() - interval '6 days')`);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "updatedAt") VALUES ('fresh1','reply','Recent question','pushed', now() - interval '1 day')`);
await q(`INSERT INTO "JarvisTask" (id, title, status, priority, "dueDate", "createdAt", "updatedAt") VALUES ('old1','Renew trade licence','todo','medium', now() - interval '10 days', now() - interval '20 days', now() - interval '10 days')`);
await housekeeping();
await housekeeping();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'exp1'`)).status, 'expired');
assert.equal((await one(`SELECT "resolvedBy" FROM "JarvisSignal" WHERE id = 'stale1'`)).resolvedBy, 'expired');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'fresh1'`)).status, 'pushed');
assert.ok(await one(`SELECT id FROM "JarvisLedger" WHERE "signalId" = 'exp1' AND "closedBy" = 'expired'`));
assert.equal((await q(`SELECT id FROM "JarvisSignal" WHERE kind = 'nudge' AND "threadKey" = 'task:old1'`)).length, 1, 'one still-relevant card per task');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'old1'`)).status, 'todo', 'tasks are never deleted');
assert.equal(await expireSignals(), 0);

// Digest and close-out run cleanly; held items are counted, never dropped.
const waiting = await waitingCounts();
assert.ok(waiting.replies + waiting.other >= 1);
const d = await digestTick({ force: true });
assert.equal(d.sent, true);
assert.match(d.body, /done by Jarvis/);
await eveningCloseout();

console.log('INTEGRATION OK');
await pool.end();
process.exit(0);
