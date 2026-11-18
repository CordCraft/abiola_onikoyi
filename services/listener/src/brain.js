import { config } from './config.js';
import { q, one, newId } from './db.js';
import { structured } from './llm.js';
import { goalsAndProjects, people, openSignals, upcoming, fmtEvents, rhythm, OWNER_BRIEF } from './context.js';
import { clip } from './util.js';
import { pushSignal } from './push.js';
import { enqueue } from './jobs.js';
import { prefilterReason, mustKeep, isUrgent, shouldTriageNow, makeLimiter } from './gate.js';

// The triage brain: reads new messages in small batches, finds what matters, and turns it
// into signals with one-tap actions. The model proposes; this code decides what may run
// without asking (only calendar holds for clearly agreed meetings, and private tasks).

const BATCH = 30;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inbound_ids', 'kind', 'title', 'detail', 'why', 'score', 'project_id', 'same_as_signal_id', 'due_at', 'person', 'calendar', 'task', 'reply'],
        properties: {
          inbound_ids: { type: 'array', items: { type: 'string' } },
          kind: { type: 'string', enum: ['event', 'task', 'reply', 'opportunity', 'followup', 'fyi'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          why: { type: 'string' },
          score: { type: 'integer' },
          project_id: { type: 'string' },
          same_as_signal_id: { type: 'string' },
          due_at: { type: 'string' },
          person: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'name', 'relation', 'org'],
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              relation: { type: 'string', enum: ['family', 'team', 'client', 'partner', 'investor', 'vendor', 'friend', 'other', ''] },
              org: { type: 'string' },
            },
          },
          calendar: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'start', 'end', 'all_day', 'location', 'purpose', 'confirmed'],
            properties: {
              title: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' },
              all_day: { type: 'boolean' },
              location: { type: 'string' },
              purpose: { type: 'string', enum: ['work', 'personal'] },
              confirmed: { type: 'boolean' },
            },
          },
          task: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'due_date', 'priority'],
            properties: {
              title: { type: 'string' },
              due_date: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
          reply: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
        },
      },
    },
  },
};

const RULES = `You are Jarvis, the owner's silent chief of staff. You read every new WhatsApp message and email (both what others send him and what he writes) and decide what deserves his attention. Most messages deserve nothing: greetings, newsletters, receipts, OTP codes, notifications, group chatter not involving him. Return an item only when there is something to do, decide, attend, or seize.

Item kinds:
- event: a meeting, call, appointment, flight, deadline-with-a-time, school or family event with a specific date (and usually time). Fill "calendar" (ISO 8601 with the owner's UTC offset for start and end; default 60 minutes if no end; all_day true with YYYY-MM-DD dates when there is no time). purpose "work" for business, "personal" for family, health, friends, church, personal admin. confirmed true only if the date and time are agreed (not merely proposed or asked).
- task: something the owner must do (including promises HE made in his own messages, such as "I will send it tomorrow"). Fill "task" (due_date YYYY-MM-DD or "").
- reply: someone is waiting on an answer from him and the thread has gone unanswered. Draft a short reply in "reply.text" in his voice: warm, direct, brief, no em dashes, same language as the thread, no promises he did not make.
- opportunity: money, a deal, a partner, an intro, a tender, a client lead, a chance to move a venture or the USD 1M goal forward.
- followup: something he is waiting on from someone else that is going stale, or a person worth reconnecting with.
- fyi: important to know but no action (a payment received, a decision someone else made).

score 0-100 = how much this matters to him now: money at stake and closeness to revenue, deadline nearness, who is waiting (family, clients and partners rank high), and fit with his goals and active projects. Routine admin is 20-40, real business with a deadline 60-85, urgent money or family matters 85-100.
title: under 70 characters, starts with the essence (for example "Taslim wants the PEL doc by Friday"). detail: 1-3 sentences with the facts he needs. why: one short line linking it to a goal, project or person.
project_id: the id of the matching project from the list, or "". same_as_signal_id: if this is the same thing as an open signal listed below, its id (then it only updates that one), else "".
person: the main other person (key = phone digits or lowercase email, from the message sender), relation guess, org if known; empty strings if none.
due_at: ISO time it matters by, or "".
inbound_ids: the message ids this item comes from. Group several messages about one thing into one item.
Fill unused sub-objects with empty strings and false. Never invent facts that are not in the messages. Never use em dashes.`;

// Which mailbox an email arrived in (outlook:<mailbox>:<id>, gmail:<mailbox>:<id>).
function mailboxOf(m) {
  if (m.source !== 'outlook' && m.source !== 'gmail') return '';
  return String(m.externalId || '').split(':')[1] || '';
}

function fmtMessage(m, ctx) {
  const who = m.direction === 'out' ? 'YOU (the owner) wrote' : `${m.senderName || m.sender || 'unknown'}${m.sender && m.senderName !== m.sender ? ` <${m.sender}>` : ''}`;
  const where = m.source === 'whatsapp' ? `WhatsApp ${m.isGroup ? `group "${m.chatName}"` : `chat${m.chatName ? ` with ${m.chatName}` : ''}`}` : `${m.source}${mailboxOf(m) ? ` to ${mailboxOf(m)}` : ''} ${m.subject ? `"${clip(m.subject, 120)}"` : ''}`;
  const when = new Date(m.occurredAt).toLocaleString('en-GB', { timeZone: ctx.tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `[${m.id}] ${when} | ${where} | ${who}:\n${clip(m.body, 1500)}`;
}

async function threadContext(batch) {
  // The last few earlier messages in each thread, so a reply is read in context.
  const keys = [...new Set(batch.map((m) => m.threadKey).filter(Boolean))].slice(0, 20);
  if (!keys.length) return '';
  const rows = await q(
    `SELECT * FROM (
       SELECT i.*, row_number() OVER (PARTITION BY "threadKey" ORDER BY "occurredAt" DESC) AS rn
       FROM "JarvisInbound" i WHERE "threadKey" = ANY($1) AND "triagedAt" IS NOT NULL
     ) t WHERE rn <= 4 ORDER BY "threadKey", "occurredAt"`,
    [keys],
  );
  return rows.map((m) => `(${m.threadKey}) ${m.direction === 'out' ? 'YOU' : m.senderName || m.sender}: ${clip(m.body, 300)}`).join('\n');
}

// ---- Cost control ---------------------------------------------------------------------------
// Three steps, cheapest first, so the main model only reads what can matter:
//   1. prefilter (code, free): acknowledgements, OTPs, media without caption, automated senders.
//   2. gate (claude-haiku-5-5): drops what clearly needs nothing; unsure means keep.
//   3. triage (claude-sonnet-5-5): batches of what is left, held a few minutes so a trickle of
//      messages becomes one call instead of one call each (important people skip the wait).
// The owner context (goals, projects, people, calendar) is a cached, byte-stable system block.

const GATE_BATCH = 40;
const limiter = makeLimiter(config.triageMaxCallsPerHour);
let gateFailures = 0;
let gateOffUntil = 0;

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['drop_ids'],
  properties: { drop_ids: { type: 'array', items: { type: 'string' } } },
};

const GATE_RULES = `You screen new WhatsApp messages and emails for a busy founder's chief of staff. For each message decide whether anything could need doing, deciding, scheduling, answering, remembering or following up. List in drop_ids ONLY the messages where it is clear that nothing is needed: greetings, thanks and acknowledgements, banter, memes and jokes, chatter between other people in a group, newsletters, marketing, social media or app notifications, login alerts, delivered-parcel notices, receipts with nothing due. KEEP (do not list) anything where someone asks him something or waits on him, a meeting, call, event, trip or deadline is mentioned, money, a payment, an invoice, a deal, a contract, a client, partner or investor is involved, there is a task or a promise by anyone, it concerns family, school or health, it is a voice note, or you are unsure. When in doubt, keep. Never list an id that is not in the input.`;

async function markSkipped(ids, why) {
  if (!ids.length) return;
  await q(`UPDATE "JarvisInbound" SET "triagedAt" = now(), triage = $2::jsonb WHERE id = ANY($1)`, [ids, JSON.stringify({ skipped: why })]);
}

async function importantSenders(messages) {
  const keys = [...new Set(messages.filter((m) => !m.isGroup && m.direction !== 'out').map((m) => String(m.sender || '').toLowerCase()).filter(Boolean))];
  if (!keys.length) return new Set();
  const rows = await q(`SELECT key FROM "JarvisPerson" WHERE key = ANY($1) AND importance >= 70`, [keys]).catch(() => []);
  return new Set(rows.map((r) => r.key));
}

// Step 1 and 2: decide which new messages deserve the main model. Returns how many it looked at.
async function gatePhase() {
  const batch = await q(
    `SELECT * FROM "JarvisInbound" WHERE "triagedAt" IS NULL AND (triage IS NULL OR triage->>'gate' IS NULL) ORDER BY "occurredAt" ASC LIMIT ${GATE_BATCH}`,
  );
  if (!batch.length) return 0;

  // Old backlog (more than 3 days) is kept as memory but not triaged.
  const stale = batch.filter((m) => Date.now() - new Date(m.occurredAt).getTime() > 3 * 864e5);
  await markSkipped(stale.map((m) => m.id), 'old');
  const live = batch.filter((m) => !stale.includes(m));

  const trivial = [];
  const rest = [];
  for (const m of live) {
    const why = prefilterReason(m);
    if (why) trivial.push([m, why]);
    else rest.push(m);
  }
  for (const why of new Set(trivial.map((t) => t[1]))) await markSkipped(trivial.filter((t) => t[1] === why).map((t) => t[0].id), `prefilter:${why}`);
  if (!rest.length) return batch.length;

  const important = await importantSenders(rest);
  const keepIds = new Set();
  const ask = [];
  for (const m of rest) {
    if (mustKeep(m, important)) keepIds.add(m.id);
    else ask.push(m);
  }

  let dropIds = new Set();
  if (ask.length && config.gateEnabled && Date.now() >= gateOffUntil) {
    const user = ask
      .map((m) => `[${m.id}] ${m.source}${m.isGroup ? ` group "${clip(m.chatName, 40)}"` : ''}${m.subject ? ` subject "${clip(m.subject, 80)}"` : ''} | ${m.direction === 'out' ? 'FROM THE OWNER' : `from ${clip(m.senderName || m.sender, 40)}`}: ${clip(m.body, 500)}`)
      .join('\n\n');
    try {
      const res = await structured({ model: config.gateModel, system: GATE_RULES, user: `Messages:\n\n${user}`, schema: GATE_SCHEMA, effort: 'low', maxTokens: 2000, label: 'gate', fallback: false });
      const valid = new Set(ask.map((m) => m.id));
      dropIds = new Set((res.drop_ids || []).filter((id) => valid.has(id)));
      gateFailures = 0;
    } catch (e) {
      // Fail safe: if the gate breaks, everything goes to the main model as before.
      console.error('[brain] gate failed, keeping all:', e.message);
      gateFailures += 1;
      if (gateFailures >= 3) gateOffUntil = Date.now() + 3600e3;
    }
  }
  await markSkipped([...dropIds], 'gate');
  const keep = rest.filter((m) => !dropIds.has(m.id)).map((m) => m.id);
  if (keep.length) await q(`UPDATE "JarvisInbound" SET triage = COALESCE(triage, '{}'::jsonb) || '{"gate":"keep"}'::jsonb WHERE id = ANY($1)`, [keep]);
  return batch.length;
}

// The owner's world as one stable block. Rebuilt at most every 10 minutes so its bytes stay
// identical between calls and the prompt cache can be read instead of re-paid.
let snapshotMemo = { at: 0, text: '', tz: '' };
async function stableSnapshot(r) {
  if (snapshotMemo.text && Date.now() - snapshotMemo.at < 10 * 60e3 && snapshotMemo.tz === r.tz) return snapshotMemo.text;
  const [{ goals, projects, ventures }, known, events] = await Promise.all([goalsAndProjects(), people(), upcoming(10)]);
  const text = [
    `Goals:\n${goals.map((g) => `- ${g.title}${g.horizon ? ` (${g.horizon})` : ''}`).join('\n') || '(none)'}`,
    `Ventures: ${ventures.map((v) => v.name).join(', ') || '(none)'}`,
    `Projects (id | name | status | priority):\n${projects.map((p) => `- ${p.id} | ${p.name}${p.venture ? ` [${p.venture}]` : ''} | ${p.status} | ${p.priority}`).join('\n') || '(none)'}`,
    `Known people:\n${known.map((p) => `- ${p.key} ${p.name || ''} ${p.relation ? `(${p.relation})` : ''} ${p.org || ''}`.trim()).join('\n') || '(none yet)'}`,
    `Calendar next 10 days:\n${fmtEvents(events, r.tz)}`,
  ].join('\n\n');
  snapshotMemo = { at: Date.now(), text, tz: r.tz };
  return text;
}

// Step 3: the main model, on what the gate kept.
async function triagePhase() {
  const ready = await q(
    `SELECT * FROM "JarvisInbound" WHERE "triagedAt" IS NULL AND triage->>'gate' = 'keep' ORDER BY "occurredAt" ASC LIMIT ${BATCH}`,
  );
  if (!ready.length) return 0;

  const important = await importantSenders(ready);
  const oldest = Math.min(...ready.map((m) => new Date(m.createdAt || m.occurredAt).getTime()));
  const go = shouldTriageNow({
    count: ready.length,
    oldestAgeMs: Date.now() - oldest,
    urgent: ready.some((m) => isUrgent(m, important)),
    minBatch: config.triageMinBatch,
    maxWaitMs: config.triageMaxWaitMin * 60e3,
  });
  if (!go) return 0;
  if (!limiter.allow()) {
    console.error(`[brain] hourly triage cap reached (${config.triageMaxCallsPerHour}); messages wait for the next hour`);
    return 0;
  }

  const fresh = ready;
  const r = await rhythm();
  const ctx = { tz: r.tz };
  const [snapshot, open, history] = await Promise.all([stableSnapshot(r), openSignals(), threadContext(fresh)]);
  const nowLocal = new Date().toLocaleString('en-GB', { timeZone: r.tz, dateStyle: 'full', timeStyle: 'short' });

  // Stable first (instructions, then the owner's world with the cache breakpoint); everything
  // that changes per call (time, open signals, the messages) goes in the user turn.
  const system = [
    { type: 'text', text: `${OWNER_BRIEF}\n\n${RULES}` },
    { type: 'text', text: snapshot, cache_control: { type: 'ephemeral' } },
  ];
  const user = `Now: ${nowLocal} (${r.tz}).\n\nOpen signals (id | kind | title):\n${open.map((s) => `- ${s.id} | ${s.kind} | ${s.title}`).join('\n') || '(none)'}\n\n${history ? `Earlier messages in these threads, for context only:\n${history}\n\n` : ''}New messages to triage:\n\n${fresh.map((m) => fmtMessage(m, ctx)).join('\n\n')}`;

  let result;
  limiter.record();
  try {
    result = await structured({ model: config.triageModel, system, user, schema: SCHEMA, effort: 'medium', maxTokens: 8000, label: 'triage' });
  } catch (e) {
    console.error('[brain] triage call failed:', e.message);
    // Leave them untriaged so the next round retries, unless the batch keeps failing.
    await q(`UPDATE "JarvisInbound" SET triage = COALESCE(triage, '{}'::jsonb) || jsonb_build_object('error', $2::text, 'tries', COALESCE((triage->>'tries')::int, 0) + 1) WHERE id = ANY($1)`, [fresh.map((m) => m.id), e.message.slice(0, 200)]);
    await q(`UPDATE "JarvisInbound" SET "triagedAt" = now() WHERE id = ANY($1) AND COALESCE((triage->>'tries')::int, 0) >= 3`, [fresh.map((m) => m.id)]);
    return 0;
  }

  const freshIds = new Set(fresh.map((m) => m.id));
  const byId = new Map(fresh.map((m) => [m.id, m]));
  for (const item of result.items || []) {
    const ids = (item.inbound_ids || []).filter((id) => freshIds.has(id));
    if (!ids.length) continue;
    await upsertPerson(item, byId.get(ids[0]));
    await saveSignal(item, ids, byId, r).catch((e) => console.error('[brain] save signal', e.message));
  }
  await q(`UPDATE "JarvisInbound" SET "triagedAt" = now(), triage = '{"ok":true}' WHERE id = ANY($1)`, [fresh.map((m) => m.id)]);
  await touchPeople(fresh);
  return fresh.length;
}

// Called every 45 seconds. Returns the most rows either step handled, so the caller can keep
// going while a backlog is draining.
export async function triageOnce() {
  const gated = await gatePhase();
  const triaged = await triagePhase();
  return Math.max(gated, triaged);
}

function validIso(s) {
  return s && !Number.isNaN(new Date(s).getTime());
}

async function saveSignal(item, ids, byId, r) {
  const first = byId.get(ids[0]);
  let action = null;
  let autonomy = 'ask';
  if (item.kind === 'event' && validIso(item.calendar.start)) {
    action = {
      type: 'calendar_event',
      payload: {
        purpose: item.calendar.purpose || 'work',
        title: item.calendar.title || item.title,
        start: item.calendar.start,
        end: validIso(item.calendar.end) ? item.calendar.end : null,
        allDay: !!item.calendar.all_day,
        location: item.calendar.location || null,
        description: item.detail,
        tentative: !item.calendar.confirmed,
        tz: r.tz,
      },
    };
    // An agreed meeting with a clear time goes straight onto the calendar (tentative), with undo.
    if (item.calendar.confirmed && !item.calendar.all_day) autonomy = 'auto';
  } else if (item.kind === 'task' || item.kind === 'followup' || item.kind === 'opportunity') {
    action = {
      type: 'create_task',
      payload: { title: item.task.title || item.title, dueDate: item.task.due_date || null, priority: item.task.priority || 'medium', projectId: item.project_id || null },
    };
    if (item.kind === 'task') autonomy = 'auto';
  } else if (item.kind === 'reply' && item.reply.text) {
    action = {
      type: 'send_reply',
      payload: {
        channel: first.source,
        connectionId: first.connectionId,
        threadKey: first.threadKey,
        to: first.sender,
        subject: first.subject ? (/^re:/i.test(first.subject) ? first.subject : `Re: ${first.subject}`) : '',
        replyToExternalId: first.externalId,
        text: item.reply.text,
      },
    };
  }

  const score = Math.max(0, Math.min(100, Math.round(item.score || 0)));
  const projectId = item.project_id && (await one('SELECT id FROM "JarvisProject" WHERE id = $1', [item.project_id])) ? item.project_id : null;

  // Same thing as an open signal: refresh it rather than nagging twice.
  if (item.same_as_signal_id) {
    const existing = await one(`SELECT id, "inboundIds" FROM "JarvisSignal" WHERE id = $1`, [item.same_as_signal_id]);
    if (existing) {
      const merged = [...new Set([...(existing.inboundIds || []), ...ids])];
      await q(
        `UPDATE "JarvisSignal" SET detail = $2, score = GREATEST(score, $3), "inboundIds" = $4, action = COALESCE($5, action), "updatedAt" = now() WHERE id = $1`,
        [existing.id, item.detail, score, JSON.stringify(merged), action ? JSON.stringify(action) : null],
      );
      return;
    }
  }

  const id = newId();
  await q(
    `INSERT INTO "JarvisSignal" (id, kind, title, detail, why, score, source, "inboundIds", "projectId", "personKey", action, autonomy, status, "dueAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',$13, now())`,
    [id, item.kind, clip(item.title, 140), item.detail, item.why, score, first.source, JSON.stringify(ids), projectId, item.person.key || null, action ? JSON.stringify(action) : null, autonomy, validIso(item.due_at) ? new Date(item.due_at) : null],
  );

  if (autonomy === 'auto' && action) {
    await enqueue('apply_signal', { signalId: id, auto: true });
  } else if (item.kind !== 'fyi') {
    await pushSignal(id).catch((e) => console.error('[brain] push', e.message));
  }
}

async function upsertPerson(item, msg) {
  const key = String(item.person?.key || '').toLowerCase().trim();
  if (!key) return;
  const importance = item.person.relation === 'family' ? 90 : ['client', 'partner', 'investor'].includes(item.person.relation) ? 70 : item.person.relation === 'team' ? 55 : 30;
  await q(
    `INSERT INTO "JarvisPerson" (id, key, name, relation, org, importance, "projectId", "openLoops", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (key) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), "JarvisPerson".name),
       relation = COALESCE(NULLIF(EXCLUDED.relation, ''), "JarvisPerson".relation),
       org = COALESCE(NULLIF(EXCLUDED.org, ''), "JarvisPerson".org),
       importance = GREATEST("JarvisPerson".importance, EXCLUDED.importance),
       "openLoops" = "JarvisPerson"."openLoops" + EXCLUDED."openLoops",
       "updatedAt" = now()`,
    [newId(), key, item.person.name || msg?.senderName || null, item.person.relation || null, item.person.org || null, importance, item.project_id || null, ['reply', 'task', 'followup'].includes(item.kind) ? 1 : 0],
  );
}

async function touchPeople(messages) {
  for (const m of messages) {
    const key = String(m.direction === 'out' ? '' : m.sender || '').toLowerCase();
    if (!key) continue;
    await q(`UPDATE "JarvisPerson" SET "lastInboundAt" = GREATEST(COALESCE("lastInboundAt", 'epoch'), $2) WHERE key = $1`, [key, m.occurredAt]).catch(() => {});
  }
}
