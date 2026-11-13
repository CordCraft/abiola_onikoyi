// End-to-end check of the listener's SQL against a real Postgres with the full schema
// (run against an embedded test database, never production). The model is faked.
// Usage: DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres DB_POOL_MAX=1 node test/integration.mjs
import assert from 'node:assert/strict';

process.env.JARVIS_ENCRYPTION_KEY ||= 'test';
process.env.ANTHROPIC_API_KEY ||= 'test';
process.env.DATA_DIR ||= './.data';

const { ensureTables, q, one, pool, probeV3, v3State, getSetting, setSetting } = await import('../src/db.js');
const { storeInbound } = await import('../src/accounts.js');
const { triageOnce } = await import('../src/brain.js');
const { runJobs } = await import('../src/executor.js');
const { morningPlan, learnRhythm, housekeeping, plannerTick } = await import('../src/planner.js');
const { flushHeld, mayInterrupt } = await import('../src/push.js');
const { reconcileOnce, createCleanupCard, cleanupTick, expireSignals, reconcileFromTriage } = await import('../src/reconcile.js');
const { digestTick, waitingCounts } = await import('../src/digest.js');
const { eveningCloseout } = await import('../src/planner.js');

await ensureTables();
await ensureTables(); // idempotent
assert.equal(await probeV3(), true, 'the test database has every v3 column');
assert.equal(v3State.ready, true);

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
const t3 = await createTask({ title: 'Board pack Q4 numbers', threadKey: 'th-board' });
assert.equal(t3.taskId, t1.taskId, 'same thread key and a loosely similar title links');
const t3b = await createTask({ title: 'Totally different words here', threadKey: 'th-board' });
assert.notEqual(t3b.taskId, t1.taskId, 'same thread alone is not enough: the title must be at least 0.4 similar');
const n1a = await createTask({ title: 'Send invoice to Taslim' });
const n1b = await createTask({ title: 'Send invoice to Bola' });
assert.notEqual(n1b.taskId, n1a.taskId, 'a different capitalised name is a different task');
const n2a = await createTask({ title: 'Pay supplier invoice 2041 this week' });
const n2b = await createTask({ title: 'Pay supplier invoice 2042 this week' });
assert.notEqual(n2b.taskId, n2a.taskId, 'a different number is a different task');
const n3b = await createTask({ title: 'Send the invoice to Taslim' });
assert.equal(n3b.taskId, n1a.taskId, 'same words still link');
const t4 = await createTask({ title: 'Book flight to Dhahran' });
assert.notEqual(t4.taskId, t1.taskId);

// Fixtures for the clean-up: duplicates, a task done by an outgoing message, a task linked to the reply card.
const ins = async (id, title, extra = {}) => q(`INSERT INTO "JarvisTask" (id, title, status, priority, "createdAt", "updatedAt", "sourceSignalId") VALUES ($1,$2,'todo','medium', now() - ($3 || ' hours')::interval, now(), $4)`, [id, title, String(extra.age || 1), extra.sig || null]);
await ins('w1', 'Saudi Eagles water', { age: 50 });
await ins('w2', 'Saudi Eagles water delivery', { age: 40 });
await ins('w3', 'Pay Saudi Eagles water', { age: 30 });
await ins('agr', 'Send draft agreement to Upstream group');
await ins('lnk', 'Confirm invoice 2041 amount', { sig: replyBefore.id });
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "expiresAt", "updatedAt") VALUES ('gx','event','Pre-card expired event','new', now() - interval '1 hour', now())`);
closeIds = ['agr'];
const person0 = (await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops;

// The owner answered the CFO (outgoing, after the inbound), not yet triaged.
const outId = await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:SENT1', threadKey: 'gmail:me@x.com:TH1', direction: 'out', sender: 'me@x.com', recipients: 'Client CFO <cfo@client.com>', subject: 'Re: Invoice 2041', body: 'Confirmed, the amount on invoice 2041 is correct.', occurredAt: new Date(t0.getTime() + 1) });
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

// Undo sticks, and the gate shuts again: nothing from before the card is closed or expired.
const gate1 = await getSetting('v3_cleanup_proposed', null);
assert.equal(gate1.approvedAt, null, 'undo of the clean-up shuts the gate');
closeIds = ['agr'];
const afterUndo = await reconcileOnce({});
assert.equal(afterUndo.deterministic, 0, 'shut gate: nothing from before the card is closed');
assert.equal(afterUndo.model ?? 0, 0);
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'new', 'reply stays open although he already answered it (undone)');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'agr'`)).status, 'todo');
assert.equal(await expireSignals(), 0, 'expiry waits for the owner too');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'gx'`)).status, 'new');
await housekeeping();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'gx'`)).status, 'new', 'housekeeping respects the gate');

// A dismissed card is rebuilt no sooner than 3 days later.
await q(`UPDATE "JarvisSignal" SET status = 'dismissed', "decidedAt" = now() - interval '1 day', "updatedAt" = now() - interval '1 day' WHERE id = $1`, [card.id]);
assert.equal(await cleanupTick(), null, 'dismissed yesterday: too soon');
assert.equal((await one(`SELECT count(*)::int AS n FROM "JarvisSignal" WHERE action->>'type' = 'cleanup'`)).n, 1);
await q(`UPDATE "JarvisSignal" SET "decidedAt" = now() - interval '4 days', "updatedAt" = now() - interval '4 days' WHERE id = $1`, [card.id]);
closeIds = [];
const card2 = await cleanupTick();
assert.ok(card2 && card2.id !== card.id, 'a fresh proposal after 3 days');
assert.deepEqual(card2.proposal.close, [], 'the undone items are not proposed again without new evidence');
assert.equal((await getSetting('v3_cleanup_proposed', null)).cardId, card2.id);
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'gx'`)).status, 'new');
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl4', 'apply_signal', $1)`, [JSON.stringify({ signalId: card2.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [card2.id])).status, 'applied');
assert.ok((await getSetting('v3_cleanup_proposed', null)).approvedAt, 'approval opens the gate');

// Gate open, but what the owner undid stays undone until newer evidence arrives.
closeIds = ['agr'];
const stuck = await reconcileOnce({});
assert.equal(stuck.deterministic, 0);
assert.equal(stuck.model, 0);
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'new', 'undone reply is not closed by the old outgoing mail');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'agr'`)).status, 'todo', 'undone task is not offered to the model again');

// New evidence after the undo: he writes again. Triage of the outgoing mail closes the reply, and the model closes the task.
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:SENT2', threadKey: 'gmail:me@x.com:TH1', direction: 'out', sender: 'me@x.com', recipients: 'Client CFO <cfo@client.com>', subject: 'Re: Invoice 2041', body: 'Confirmed again, the amount on invoice 2041 is correct.', occurredAt: new Date() });
await storeInbound({ source: 'whatsapp', externalId: 'wa:SENT3:up@g.us', threadKey: 'wa:up@g.us', direction: 'out', sender: 'me', body: 'Here is the draft agreement for the Upstream group', isGroup: true, occurredAt: new Date() });
closeCalls = 0;
await triageOnce();
const closedSig = await one(`SELECT status, "resolvedBy", resolution FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id]);
assert.equal(closedSig.status, 'resolved');
assert.equal(closedSig.resolvedBy, 'reply');
assert.match(closedSig.resolution, /Confirmed again, the amount/);
const lnk = await one(`SELECT status, "closedBy" FROM "JarvisTask" WHERE id = 'lnk'`);
assert.equal(lnk.status, 'done');
assert.equal(lnk.closedBy, 'reply');
const led = await one(`SELECT * FROM "JarvisLedger" WHERE "signalId" = $1`, [replyBefore.id]);
assert.equal(led.closedBy, 'reply');
assert.equal(led.taskId, 'lnk');
assert.ok(closeCalls >= 1, 'model close pass ran after a batch with outgoing mail');
assert.equal((await one(`SELECT "closedBy" FROM "JarvisTask" WHERE id = 'agr'`)).closedBy, 'reconcile', 'model closes the task once newer evidence exists');
assert.ok(await one(`SELECT id FROM "JarvisLedger" WHERE "taskId" = 'agr' AND "closedBy" = 'reconcile'`));
assert.equal((await one(`SELECT "openLoops" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).openLoops, person0 - 1);
assert.ok((await one(`SELECT "lastOutboundAt" FROM "JarvisPerson" WHERE key = 'cfo@client.com'`)).lastOutboundAt, 'lastOutboundAt written for outgoing mail');
// Triage-triggered reconcile is debounced, and the model pass skips when nothing new was written.
assert.deepEqual(await reconcileFromTriage(), { skipped: 'debounced' });
const callsNow = closeCalls;
const idle = await reconcileOnce({});
assert.equal(closeCalls, callsNow, 'no model call without a new outgoing message');
assert.equal(idle.modelSkipped, 'no new outgoing message');
closeIds = [];
// Undo of a reply close brings it back, and it stays back.
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl3', 'undo_signal', $1)`, [JSON.stringify({ signalId: replyBefore.id })]);
await runJobs();
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'lnk'`)).status, 'todo');
await reconcileOnce({});
assert.notEqual((await one(`SELECT status FROM "JarvisSignal" WHERE id = $1`, [replyBefore.id])).status, 'resolved', 'undo sticks');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'lnk'`)).status, 'todo');

// Expiry and stale-task nudges.
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "expiresAt", "updatedAt") VALUES ('exp1','event','Guest checks out','new', now() - interval '1 hour', now())`);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "createdAt", "updatedAt") VALUES ('stale1','reply','Old question','pushed', now() - interval '6 days', now())`);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "createdAt", "updatedAt") VALUES ('fresh1','reply','Recent question','pushed', now() - interval '1 day', now() - interval '6 days')`);
// Snoozed into the future: never expired. A thread with a recent inbound message is not stale either (updatedAt does not count).
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "createdAt", "updatedAt", "snoozeUntil", "expiresAt") VALUES ('snz1','reply','Snoozed question','snoozed', now() - interval '6 days', now() - interval '6 days', now() + interval '1 day', now() - interval '1 hour')`);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "createdAt", "updatedAt") VALUES ('live1','reply','Active thread','pushed','gmail:me@x.com:LIVE', now() - interval '6 days', now() - interval '6 days')`);
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:LIVE1', threadKey: 'gmail:me@x.com:LIVE', sender: 'x@y.com', body: 'Still waiting on this, any news at all?', occurredAt: new Date() });
await q(`INSERT INTO "JarvisTask" (id, title, status, priority, "dueDate", "createdAt", "updatedAt") VALUES ('old1','Renew trade licence','todo','medium', now() - interval '10 days', now() - interval '20 days', now() - interval '10 days')`);
await housekeeping();
await housekeeping();
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'exp1'`)).status, 'expired');
assert.equal((await one(`SELECT "resolvedBy" FROM "JarvisSignal" WHERE id = 'stale1'`)).resolvedBy, 'expired');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'fresh1'`)).status, 'pushed');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'snz1'`)).status, 'snoozed', 'snoozed into the future is never expired');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'live1'`)).status, 'pushed', 'recent inbound on the thread keeps it alive');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'gx'`)).status, 'expired', 'after approval the pre-card item expires');
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

// ---------------- v3 phase 2: nudger, stalled tasks, learning, advice, Hostfully ----------------
const { nudgeOnce } = await import('../src/nudger.js');
const { nudgeStalledTasks } = await import('../src/reconcile.js');
const { learnBehaviour } = await import('../src/learn.js');
const { adviseOnce, weeklyAdvice } = await import('../src/advisor.js');
const v3fake = globalThis.__jarvisFakeStructured;
let nudgeCalls = 0;
let triageCalls = 0;
let lastTriageSystem = '';
globalThis.__jarvisFakeStructured = async (args) => {
  if (args.schema.required.includes('verdicts')) {
    nudgeCalls += 1;
    const keys = [...args.user.matchAll(/\[(t\d+)\][^\n]*/g)].map((m) => ({ id: m[1], line: m[0] }));
    return { verdicts: keys.map((k) => ({ id: k.id, needs_reply: /Najeeb/.test(k.line), topic: 'the Q4 figures', why: 'He asked for the Q4 figures', score: 74, draft: 'Sending the Q4 figures today — sorry for the wait.' })) };
  }
  if (args.schema.required.includes('suggestions')) {
    return { suggestions: [
      { title: 'Let Hostfully send check-in details', why: 'Nine guest questions answered by hand this week', how: 'Create a template — send it at booking' },
      { title: 'Reply to clients before 10:00', why: 'Najeeb waits 6 hours on average', how: 'Block 08:30 to 09:00 daily' },
      { title: 'Close the overdue board pack task', why: 'It has been open 12 days', how: 'Move it to Friday' },
    ] };
  }
  if (args.schema.required.includes('items')) {
    triageCalls += 1;
    lastTriageSystem = JSON.stringify(args.system);
  }
  return v3fake(args);
};
const ago = (h) => new Date(Date.now() - h * 3600e3);

// Nudger: an unanswered question from a real person becomes one "Still waiting on you" card.
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N1', threadKey: 'gmail:me@x.com:THN1', sender: 'najeeb@acme.com', senderName: 'Najeeb', subject: 'Q4 figures', body: 'Hi Abiola, can you send me the Q4 figures when you get a minute?', occurredAt: ago(10) });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N2', threadKey: 'gmail:me@x.com:THN2', sender: 'no-reply@bank.com', senderName: 'Bank', subject: 'Statement', body: 'Your statement is ready', occurredAt: ago(10) });
await storeInbound({ source: 'whatsapp', externalId: 'wa:N3:g@g.us', threadKey: 'wa:g@g.us', sender: '2348000000009', senderName: 'Chidi', body: 'Who is bringing the chairs on Saturday?', isGroup: true, chatName: 'Alumni', occurredAt: ago(10) });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N4', threadKey: 'gmail:me@x.com:THN4', sender: 'sam@acme.com', senderName: 'Najeeb Sam', subject: 'Lunch', body: 'Are you free for lunch Friday?', occurredAt: ago(10) });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N4o', threadKey: 'gmail:me@x.com:THN4', direction: 'out', sender: 'me@x.com', recipients: 'sam@acme.com', body: 'Yes, Friday works.', occurredAt: ago(9) });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N5', threadKey: 'gmail:me@x.com:THN5', sender: 'ola@acme.com', senderName: 'Ola', subject: 'Hello', body: 'Just checking in on how things are going over there.', occurredAt: ago(10) });
const n1 = await nudgeOnce();
assert.equal(n1.candidates, 2, 'newsletter, group chatter and the answered thread are skipped');
assert.equal(n1.created, 1);
assert.equal(nudgeCalls, 1);
const nudgeSig = await one(`SELECT * FROM "JarvisSignal" WHERE "threadKey" = 'gmail:me@x.com:THN1'`);
assert.equal(nudgeSig.kind, 'reply');
assert.equal(nudgeSig.title, 'Still waiting on you: Najeeb, the Q4 figures');
assert.equal(nudgeSig.score, 74);
assert.equal(nudgeSig.action.type, 'send_reply');
assert.match(nudgeSig.action.payload.text, /Q4 figures today, sorry/, 'draft kept, em dash removed');
assert.doesNotMatch(JSON.stringify(nudgeSig), /—/);
const nc = await getSetting('nudge_counts', {});
assert.equal(nc['gmail:me@x.com:THN1'].count, 1);
assert.ok((await one(`SELECT "lastNudgedAt" FROM "JarvisPerson" WHERE key = 'najeeb@acme.com'`)).lastNudgedAt, 'person lastNudgedAt written');
// Not repeated: an open card on the thread blocks it; dismissing it blocks it too (he decided).
const n2 = await nudgeOnce();
assert.equal(n2.created, 0);
assert.equal((await q(`SELECT id FROM "JarvisSignal" WHERE "threadKey" = 'gmail:me@x.com:THN1'`)).length, 1);
await q(`UPDATE "JarvisSignal" SET status = 'dismissed', "decidedAt" = now(), "updatedAt" = now() WHERE id = $1`, [nudgeSig.id]);
const n3 = await nudgeOnce();
assert.equal(n3.created, 0);
assert.equal(nudgeCalls, 1, 'the model said no to the other thread once and is not asked about it again');
assert.equal((await q(`SELECT id FROM "JarvisSignal" WHERE "threadKey" = 'gmail:me@x.com:THN1'`)).length, 1, 'still one card');

// Hostfully guest waiting while only an automated message followed: still a nudge candidate.
await storeInbound({ source: 'hostfully', externalId: 'hostfully:G1', threadKey: 'hostfully:TH-N', sender: 'Najeeb Guest', senderName: 'Najeeb Guest', subject: 'Flat 3, 2026-11-14-2026-11-16', body: 'What time can we check in?', occurredAt: ago(8) });
await storeInbound({ source: 'hostfully', externalId: 'hostfully:G1a', threadKey: 'hostfully:TH-N', direction: 'out', sender: 'hostfully-auto', senderName: 'Hostfully automated', body: '[auto] Welcome to Flat 3', occurredAt: ago(7) });
const n4 = await nudgeOnce();
assert.equal(n4.created, 1, 'an automated message is not him replying');
assert.equal((await one(`SELECT action FROM "JarvisSignal" WHERE "threadKey" = 'hostfully:TH-N'`)).action.payload.channel, 'hostfully');

// A card dismissed long before the latest message does not hide it just because its row was touched since.
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:N6', threadKey: 'gmail:me@x.com:THN6', sender: 'tola@acme.com', senderName: 'Najeeb Tola', subject: 'Contract', body: 'Hi Abiola, can you look at the contract draft today please?', occurredAt: ago(10) });
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "decidedAt", "updatedAt") VALUES ('dd6','reply','Old decision','dismissed','gmail:me@x.com:THN6', now() - interval '3 days', now())`);
const n5 = await nudgeOnce();
assert.equal(n5.created, 1, 'decided before the message, so it is raised again');

// Stalled tasks: once per 3 days.
await q(`INSERT INTO "JarvisTask" (id, title, status, priority, "createdAt", "updatedAt") VALUES ('stall1','Draft the supplier terms','todo','medium', now() - interval '6 days', now() - interval '4 days')`);
assert.equal(await nudgeStalledTasks(), 1);
assert.equal(await nudgeStalledTasks(), 0);
// A second reminder after 3 days, never a third until the task changes.
await q(`UPDATE "JarvisSignal" SET "createdAt" = now() - interval '4 days', status = 'dismissed' WHERE "threadKey" = 'task:stall1'`);
assert.equal(await nudgeStalledTasks(), 1, 'second nudge after 3 days');
await q(`UPDATE "JarvisSignal" SET "createdAt" = now() - interval '4 days', status = 'dismissed' WHERE "threadKey" = 'task:stall1'`);
assert.equal(await nudgeStalledTasks(), 0, 'at most two nudges per task');
await q(`UPDATE "JarvisTask" SET "updatedAt" = now() - interval '3 days 1 hour' WHERE id = 'stall1'`);
assert.equal(await nudgeStalledTasks(), 1, 'a change to the task restarts the count');
// Long-abandoned tasks (idle > 14 days, not overdue) get no reminder.
await q(`INSERT INTO "JarvisTask" (id, title, status, priority, "createdAt", "updatedAt") VALUES ('abandoned1','Learn the harp','todo','low', now() - interval '60 days', now() - interval '30 days')`);
assert.equal(await nudgeStalledTasks(), 0);
assert.equal(await one(`SELECT id FROM "JarvisSignal" WHERE "threadKey" = 'task:abandoned1'`), null);
const pick = await one(`SELECT title, kind FROM "JarvisSignal" WHERE "threadKey" = 'task:stall1'`);
assert.equal(pick.kind, 'nudge');
assert.equal(pick.title, 'Pick this up? Draft the supplier terms');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'stall1'`)).status, 'todo');

// Learning: latency, answer rate, dismiss rate on the person; summary in settings and in the triage prompt.
await q(`INSERT INTO "JarvisPerson" (id, key, name, relation, importance, "updatedAt") VALUES ('pl1','lena@x.com','Lena','team',55, now())`);
for (let i = 0; i < 3; i++) {
  await storeInbound({ source: 'gmail', externalId: `gmail:me@x.com:LI${i}`, threadKey: `gmail:me@x.com:LRN${i}`, sender: 'lena@x.com', senderName: 'Lena', subject: `Topic ${i}`, body: `Please review item ${i} and revert`, occurredAt: ago(100 + i * 5) });
  await storeInbound({ source: 'gmail', externalId: `gmail:me@x.com:LO${i}`, threadKey: `gmail:me@x.com:LRN${i}`, direction: 'out', sender: 'me@x.com', recipients: 'lena@x.com', body: 'Done, see attached.', occurredAt: new Date(ago(100 + i * 5).getTime() + (10 + i * 5) * 60e3) });
}
for (let i = 0; i < 5; i++) await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "personKey", "updatedAt") VALUES ($1,'opportunity','Idea ' || $1,'dismissed','lena@x.com', now())`, [`dis${i}`]);
const learned = await learnBehaviour();
assert.ok(learned.people >= 1);
const lena = await one(`SELECT "medianReplyMins", "answerRate", "dismissRate", behaviour FROM "JarvisPerson" WHERE key = 'lena@x.com'`);
assert.equal(lena.medianReplyMins, 15, 'median of 10, 15 and 20 minutes');
assert.equal(lena.answerRate, 1);
assert.equal(lena.dismissRate, 1);
assert.equal(JSON.parse(lena.behaviour).answered, 3);
const beh = await getSetting('behaviour', null);
assert.match(beh.summary.join(' '), /He usually answers Lena within 15 min/);
assert.match(beh.summary.join(' '), /dismisses opportunity cards 100% of the time/);
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:LT1', threadKey: 'gmail:me@x.com:LRNT', sender: 'ops@x.com', senderName: 'Ops', subject: 'Hello', body: 'A fresh message to triage', occurredAt: new Date() });
tripleItems = [];
await triageOnce();
assert.match(lastTriageSystem, /How he works/);
assert.match(lastTriageSystem, /answers Lena within 15 min/);

// Advice: stored, em dashes removed, top idea in the morning plan, Sunday card.
const adv = await adviseOnce({ mode: 'daily' });
assert.equal(adv.items.length, 3);
assert.doesNotMatch(JSON.stringify(adv), /—/);
assert.equal((await getSetting('advice', null)).items[0].title, 'Let Hostfully send check-in details');
const plan2 = await morningPlan({ force: true });
assert.match((await one(`SELECT detail FROM "JarvisSignal" WHERE id = $1`, [plan2.id])).detail, /Idea: Let Hostfully send check-in details/);
const wk = await weeklyAdvice();
assert.equal(wk.items, 3);
const wkSig = await one(`SELECT kind, title, detail FROM "JarvisSignal" WHERE id = $1`, [wk.id]);
assert.equal(wkSig.kind, 'plan');
assert.equal(wkSig.title, 'Ideas for this week');
assert.match(wkSig.detail, /How: Block 08:30/);

// Hostfully: Airbnb notification emails are skipped while the connector is healthy, triaged when it is not.
await setSetting('hostfully_status', { ok: true, lastRunAt: new Date().toISOString(), lastError: null });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:AB1', threadKey: 'gmail:me@x.com:THAB1', sender: 'automated@airbnb.com', senderName: 'Airbnb', subject: 'Message from Sara', body: 'Sara sent you a message: what time is check-in?', occurredAt: new Date() });
const callsBefore = triageCalls;
await triageOnce();
assert.equal((await one(`SELECT triage->>'skipped' AS s FROM "JarvisInbound" WHERE "externalId" = 'gmail:me@x.com:AB1'`)).s, 'hostfully');
assert.equal(triageCalls, callsBefore, 'no model call for a batch of only Airbnb notifications');
await setSetting('hostfully_status', { ok: true, lastRunAt: ago(1).toISOString(), lastError: null });
await storeInbound({ source: 'gmail', externalId: 'gmail:me@x.com:AB2', threadKey: 'gmail:me@x.com:THAB2', sender: 'automated@airbnb.com', senderName: 'Airbnb', subject: 'Message from Omar', body: 'Omar sent you a message', occurredAt: new Date() });
await triageOnce();
assert.equal((await one(`SELECT triage->>'ok' AS ok FROM "JarvisInbound" WHERE "externalId" = 'gmail:me@x.com:AB2'`)).ok, 'true', 'stale connector: triaged normally');
assert.equal(triageCalls, callsBefore + 1);

// Hostfully send path through the job queue, with a mocked API.
process.env.HOSTFULLY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ method: init.method, path: u.pathname, query: u.search, body: init.body ? JSON.parse(init.body) : null, key: init.headers?.['X-HOSTFULLY-APIKEY'] });
  const body = init.method === 'POST' ? { uid: 'sent-1' } : { messages: [{ uid: 'm1', threadUid: 'TH-N', leadUid: 'L1', type: 'DIRECT_MESSAGE' }] };
  return new Response(JSON.stringify(body), { status: 200 });
};
try {
  const hfSig = await one(`SELECT id FROM "JarvisSignal" WHERE "threadKey" = 'hostfully:TH-N'`);
  await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('hf1', 'apply_signal', $1)`, [JSON.stringify({ signalId: hfSig.id, text: 'Check-in is from 3pm. See you soon.' })]);
  await runJobs();
} finally {
  globalThis.fetch = realFetch;
  delete process.env.HOSTFULLY_API_KEY;
}
const post = calls.find((c) => c.method === 'POST');
assert.ok(post, 'posted to Hostfully');
assert.equal(post.path.endsWith('/messages'), true);
assert.equal(post.key, 'test-key');
assert.equal(post.body.leadUid, 'L1');
assert.equal(post.body.threadUid, 'TH-N');
assert.equal(post.body.type, 'DIRECT_MESSAGE');
assert.equal(post.body.content.text, 'Check-in is from 3pm. See you soon.');
const hfDone = await one(`SELECT status, result FROM "JarvisSignal" WHERE "threadKey" = 'hostfully:TH-N'`);
assert.equal(hfDone.status, 'applied');
assert.equal(hfDone.result.sent.messageUid, 'sent-1');

// Reconcile on Hostfully threads: an automated message settles check-in detail items only.
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "updatedAt") VALUES ('hfa','reply','Guest asks for check-in details','new','hostfully:TH-C', now()), ('hfb','reply','Guest wants a late checkout','new','hostfully:TH-D', now())`);
const later = new Date(Date.now() + 120e3);
await storeInbound({ source: 'hostfully', externalId: 'hostfully:C1', threadKey: 'hostfully:TH-C', direction: 'out', sender: 'hostfully-auto', body: '[auto] Your door code is 4821', occurredAt: later });
await storeInbound({ source: 'hostfully', externalId: 'hostfully:D1', threadKey: 'hostfully:TH-D', direction: 'out', sender: 'hostfully-auto', body: '[auto] Your door code is 4821', occurredAt: later });
await reconcileOnce({ model: false });
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'hfa'`)).status, 'resolved');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'hfb'`)).status, 'new');
await storeInbound({ source: 'hostfully', externalId: 'hostfully:D2', threadKey: 'hostfully:TH-D', direction: 'out', sender: 'host', body: 'Late checkout at 1pm is fine.', occurredAt: new Date(later.getTime() + 60e3) });
await reconcileOnce({ model: false });
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'hfb'`)).status, 'resolved');

// Deterministic close ignores acknowledgements, short replies, WhatsApp groups and his own promises.
const tlater = (ms) => new Date(Date.now() + ms);
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "updatedAt") VALUES ('ack1','reply','Tola wants the figures','new','wa:5550001@s.whatsapp.net', now()), ('grp1','reply','Group asks for the deck','new','wa:77@g.us', now())`);
await storeInbound({ source: 'whatsapp', externalId: 'wa:ACK1', threadKey: 'wa:5550001@s.whatsapp.net', direction: 'out', sender: 'me', body: 'ok thanks', occurredAt: tlater(1000) });
await storeInbound({ source: 'whatsapp', externalId: 'wa:ACK2', threadKey: 'wa:5550001@s.whatsapp.net', direction: 'out', sender: 'me', body: 'Sent!', occurredAt: tlater(2000) });
await storeInbound({ source: 'whatsapp', externalId: 'wa:GRP1', threadKey: 'wa:77@g.us', direction: 'out', sender: 'me', body: 'Here is the deck for everyone in the group', isGroup: true, occurredAt: tlater(1000) });
const ownOut = await storeInbound({ source: 'whatsapp', externalId: 'wa:OWN0', threadKey: 'wa:5550002@s.whatsapp.net', direction: 'out', sender: 'me', body: 'I will send you the deck on Monday', occurredAt: tlater(0) });
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "inboundIds", "updatedAt") VALUES ('fu1','followup','Send Ola the deck','new','wa:5550002@s.whatsapp.net', $1, now())`, [JSON.stringify([ownOut])]);
await storeInbound({ source: 'whatsapp', externalId: 'wa:OWN1', threadKey: 'wa:5550002@s.whatsapp.net', direction: 'out', sender: 'me', body: 'Here is the deck as promised, let me know', occurredAt: tlater(3000) });
await reconcileOnce({ model: false });
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'ack1'`)).status, 'new', 'acknowledgements and short replies do not close');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'grp1'`)).status, 'new', 'WhatsApp groups are left to the model');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'fu1'`)).status, 'new', 'his own promise is left to the model');
await storeInbound({ source: 'whatsapp', externalId: 'wa:ACK3', threadKey: 'wa:5550001@s.whatsapp.net', direction: 'out', sender: 'me', body: 'I will send the figures tomorrow morning', occurredAt: tlater(4000) });
await reconcileOnce({ model: false });
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'ack1'`)).status, 'resolved', 'a substantive reply closes');

// Fresh signal when new activity arrives on a thread whose card is already applied or resolved.
const sameThread = async (id, threadKey, status) => {
  await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, "threadKey", "decidedAt", "resolvedAt", "updatedAt") VALUES ($1,'reply','Earlier question',$2,$3, now(), now(), now())`, [id, status, threadKey]);
};
await sameThread('mg1', 'gmail:me@x.com:THR1', 'resolved');
await sameThread('mg2', 'gmail:me@x.com:THR2', 'applied');
await sameThread('mg3', 'gmail:me@x.com:THR3', 'expired');
await sameThread('mg4', 'gmail:me@x.com:THR4', 'pushed');
const mIds = [];
for (const [i, th] of ['THR1', 'THR2', 'THR3', 'THR4'].entries()) {
  mIds.push(await storeInbound({ source: 'gmail', externalId: `gmail:me@x.com:MG${i}`, threadKey: `gmail:me@x.com:${th}`, sender: `p${i}@y.com`, senderName: `Pat ${i}`, subject: 'Question', body: `Another question number ${i}, can you answer today please?`, occurredAt: new Date() }));
}
tripleItems = mIds.map((id, i) => ({ inbound_ids: [id], kind: 'reply', title: `New question ${i}`, detail: 'Needs an answer.', why: 'Client', score: 70, project_id: '', same_as_signal_id: '', due_at: '', expires_at: '', person: { key: `p${i}@y.com`, name: `Pat ${i}`, relation: 'client', org: '' }, calendar: noCal, task: noTask, reply: { text: 'On it.' } }));
await triageOnce();
tripleItems = [];
for (const [id, th] of [['mg1', 'THR1'], ['mg2', 'THR2'], ['mg3', 'THR3']]) {
  const rows = await q(`SELECT id, status FROM "JarvisSignal" WHERE "threadKey" = $1 ORDER BY "createdAt"`, [`gmail:me@x.com:${th}`]);
  assert.equal(rows.length, 2, `${th}: a finished card is not merged into`);
  assert.equal(rows[0].id, id);
  assert.ok(['new', 'pushed'].includes(rows[1].status), 'the new card is open');
}
assert.equal((await q(`SELECT id FROM "JarvisSignal" WHERE "threadKey" = 'gmail:me@x.com:THR4'`)).length, 1, 'an open card is still merged into');
assert.equal((await one(`SELECT status FROM "JarvisSignal" WHERE id = 'mg1'`)).status, 'resolved');

// A clean-up card is applied only to items untouched since it was made; closing a task keeps its status for undo.
await q(`INSERT INTO "JarvisTask" (id, title, status, priority, "createdAt", "updatedAt") VALUES ('c1','Settle the generator bill','doing','medium', now(), now()), ('c2','Renew the gym membership','todo','medium', now(), now()), ('c3','Water the office plants','todo','medium', now(), now())`);
await q(`UPDATE "JarvisTask" SET recurrence = 'weekly' WHERE id = 'c3'`);
closeIds = ['c1', 'c2', 'c3'];
const card3 = await createCleanupCard({ force: true });
assert.deepEqual(card3.proposal.close.map((c) => c.id).sort(), ['c1', 'c2'], 'recurring tasks are never proposed');
await q(`UPDATE "JarvisTask" SET title = 'Renew the gym membership (annual)', "updatedAt" = now() WHERE id = 'c2'`);
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl5', 'apply_signal', $1)`, [JSON.stringify({ signalId: card3.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'c1'`)).status, 'done');
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'c2'`)).status, 'todo', 'changed since the card was made: skipped');
const res3 = (await one(`SELECT result FROM "JarvisSignal" WHERE id = $1`, [card3.id])).result;
assert.deepEqual(res3.cleanup.skipped, ['c2']);
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('cl6', 'undo_signal', $1)`, [JSON.stringify({ signalId: card3.id })]);
await runJobs();
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'c1'`)).status, 'doing', 'undo restores the previous status, not just todo');
closeIds = [];
// A recurring task is never closed by reconcile either.
closeIds = ['c3'];
await setSetting('v3_cleanup_proposed', { ...(await getSetting('v3_cleanup_proposed', {})), approvedAt: new Date().toISOString() });
await storeInbound({ source: 'whatsapp', externalId: 'wa:REC1', threadKey: 'wa:5550009@s.whatsapp.net', direction: 'out', sender: 'me', body: 'Watered the office plants this morning', occurredAt: new Date() });
await reconcileOnce({});
assert.equal((await one(`SELECT status FROM "JarvisTask" WHERE id = 'c3'`)).status, 'todo', 'recurring tasks are skipped');
closeIds = [];

// A signal closed while its tap was queued is cancelled, not run.
await q(`INSERT INTO "JarvisSignal" (id, kind, title, status, action, "updatedAt") VALUES ('late1','task','Closed meanwhile','resolved', '{"type":"create_task","payload":{"title":"Should not appear"}}', now())`);
await q(`INSERT INTO "JarvisJob" (id, kind, payload) VALUES ('lj1', 'apply_signal', $1)`, [JSON.stringify({ signalId: 'late1' })]);
await runJobs();
const lj = await one(`SELECT status, error FROM "JarvisJob" WHERE id = 'lj1'`);
assert.equal(lj.status, 'cancelled');
assert.match(lj.error, /already resolved/);
assert.equal(await one(`SELECT id FROM "JarvisTask" WHERE title = 'Should not appear'`), null);

console.log('INTEGRATION OK');
await pool.end();
process.exit(0);
