import { config } from './config.js';
import { q, newId, getSetting, setSetting } from './db.js';
import { structured } from './llm.js';
import { sendPush } from './push.js';
import { rhythm, goalsAndProjects, upcoming, fmtEvents, OWNER_BRIEF } from './context.js';
import { expireSignals, nudgeStaleTasks, reconcileOnce } from './reconcile.js';
import { startOfDay, closedSince } from './digest.js';
import { closeoutText } from './pure.js';
import { learnBehaviour } from './learn.js';
import { adviseOnce, topAdviceLine, weeklyAdvice } from './advisor.js';
import { minutesIn, dateKeyIn, weekdayIn, parseHm, hm, clip, tzOffsetMinutes } from './util.js';

// The day's rhythm: a morning plan, an evening close-out, nightly learning of the owner's
// real hours from when he actually sends messages, and housekeeping.

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'blocks', 'top_moves', 'stop_at', 'family_note'],
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'title', 'kind', 'signal_id', 'existing_event'],
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['focus', 'meeting', 'admin', 'family', 'break', 'personal', 'travel'] },
          signal_id: { type: 'string' },
          existing_event: { type: 'boolean' },
        },
      },
    },
    top_moves: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: { title: { type: 'string' }, why: { type: 'string' } },
      },
    },
    stop_at: { type: 'string' },
    family_note: { type: 'string' },
  },
};

async function once(key, fn) {
  const done = (await getSetting('planner_runs', {})) || {};
  if (done[key]) return;
  done[key] = new Date().toISOString();
  // Keep only the last 30 keys.
  const trimmed = Object.fromEntries(Object.entries(done).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 30));
  await setSetting('planner_runs', trimmed);
  await fn();
}

export async function morningPlan({ force = false } = {}) {
  const r = await rhythm();
  const day = dateKeyIn(r.tz);
  const weekday = weekdayIn(r.tz);
  const workday = r.workdays.includes(weekday);
  const offset = tzOffsetMinutes(r.tz);
  const startOfDay = new Date(Date.parse(`${day}T00:00:00Z`) - offset * 60e3);
  const endOfDay = new Date(startOfDay.getTime() + 864e5);
  const [events, signals, tasks, { goals, projects }] = await Promise.all([
    upcoming(1).then((evs) => evs.filter((e) => new Date(e.start) < endOfDay && new Date(e.end || e.start) >= startOfDay)),
    q(`SELECT id, kind, title, detail, score, "dueAt" FROM "JarvisSignal" WHERE status IN ('new','pushed','snoozed') AND kind <> 'plan' ORDER BY score DESC LIMIT 15`),
    q(`SELECT t.id, t.title, t.priority, t."dueDate", p.name AS project FROM "JarvisTask" t LEFT JOIN "JarvisProject" p ON p.id = t."projectId"
       WHERE t.status <> 'done' AND (t."dueDate" <= $1 OR t.priority = 'high') ORDER BY t."dueDate" NULLS LAST LIMIT 20`, [new Date(endOfDay.getTime() + 864e5)]),
    goalsAndProjects(),
  ]);

  const system = `${OWNER_BRIEF}

You are Jarvis planning his day. Build a realistic, time-blocked plan for today in ${r.tz} local time (HH:MM, 24h).
- Existing calendar events are fixed: include them as blocks with existing_event true.
- ${workday ? `It is a workday. Work runs ${r.workStart} to ${r.workEnd}.` : `It is ${weekday}, his weekend: keep work light (one optional focus block at most) and favour family, rest and personal life.`}
- Protect family time ${r.familyStart} to ${r.familyEnd} as a "family" block. stop_at is when work must end (${r.workEnd} on workdays).
- Put the highest-leverage work toward the USD 1 million goal in a morning focus block. Batch replies and admin into one or two short blocks. Leave breaks. Do not overfill: at most 70% of work time scheduled.
- top_moves: exactly three concrete moves for today that grow revenue or close something out, each tied to a real project, signal or task below. why: one line.
- summary: 2-3 short lines he can read on a lock screen. family_note: one warm, specific line about family time today.
- signal_id: the signal id a block serves, or "". No em dashes anywhere.`;

  const user = [
    `Today: ${weekday} ${day}.`,
    `Calendar today:\n${fmtEvents(events, r.tz)}`,
    `Open signals (id | kind | score | title):\n${signals.map((s) => `- ${s.id} | ${s.kind} | ${s.score} | ${s.title}${s.detail ? `: ${clip(s.detail, 160)}` : ''}`).join('\n') || '(none)'}`,
    `Tasks due soon or high priority:\n${tasks.map((t) => `- ${t.title}${t.project ? ` [${t.project}]` : ''}${t.dueDate ? ` due ${new Date(t.dueDate).toISOString().slice(0, 10)}` : ''} (${t.priority})`).join('\n') || '(none)'}`,
    `Goals:\n${goals.map((g) => `- ${g.title}`).join('\n') || '(none)'}`,
    `Active projects:\n${projects.slice(0, 20).map((p) => `- ${p.name} (${p.status}, ${p.priority})`).join('\n')}`,
  ].join('\n\n');

  const plan = await structured({ model: config.plannerModel, system, user, schema: PLAN_SCHEMA, effort: 'medium' });

  // One fresh suggestion list each morning; its top idea rides in the plan. Never blocks the plan.
  let idea = '';
  try {
    if (await adviseOnce({ mode: 'daily' })) idea = await topAdviceLine();
  } catch (e) {
    console.error('[planner] advice', e.message);
  }

  const blocksText = plan.blocks.map((b) => `${b.start}-${b.end} ${b.title}`).join('\n');
  const movesText = plan.top_moves.map((m, i) => `${i + 1}. ${m.title} (${m.why})`).join('\n');
  const detail = `${plan.summary}\n\nTop moves:\n${movesText}\n\nPlan:\n${blocksText}\n\nStop work at ${plan.stop_at}. ${plan.family_note}${idea ? `\n\n${idea}` : ''}`;

  const newBlocks = plan.blocks.filter((b) => !b.existing_event && ['focus', 'family', 'admin'].includes(b.kind));
  const id = newId();
  await q(
    `INSERT INTO "JarvisSignal" (id, kind, title, detail, why, score, source, action, autonomy, status, "updatedAt")
     VALUES ($1, 'plan', $2, $3, 'Your day, shaped around the USD 1M goal and family time', 70, 'planner', $4, 'ask', 'new', now())`,
    [id, `Your plan for ${weekday}`, detail, JSON.stringify({ type: 'plan_blocks', payload: { day, tz: r.tz, blocks: newBlocks, plan } })],
  );
  // Also the classic briefing note, so the existing overview card shows it.
  await q(`INSERT INTO "JarvisNote" (id, body, source, "createdAt") VALUES ($1, $2, 'briefing', now())`, [newId(), `Morning briefing: ${plan.summary}\n\n${movesText}`]).catch(() => {});

  await sendPush({
    title: `Good morning. Your ${weekday} is planned`,
    body: clip(`${plan.summary} Tap to see the plan${newBlocks.length ? ' and block it on your calendar' : ''}.`, 230),
    url: `/jarvis/signals/${id}`,
    tag: `jarvis-plan-${day}`,
    signalId: id,
    actions: newBlocks.length ? [{ action: 'approve', title: 'Block my calendar' }] : [],
  });
  await q(`UPDATE "JarvisSignal" SET status = 'pushed', "pushedAt" = now() WHERE id = $1`, [id]);
  return { id, force };
}

export async function eveningCloseout() {
  const r = await rhythm();
  const [closed, open] = await Promise.all([
    closedSince(startOfDay(r.tz)),
    q(`SELECT title FROM "JarvisSignal" WHERE status IN ('new','pushed') AND kind <> 'plan' AND kind <> 'fyi' ORDER BY score DESC LIMIT 3`),
  ]);
  if (!r.stopWorkPush && !closed.length && !open.length) return;
  await sendPush({
    // The "time to stop work" nudge is opt-in; the close-out itself is always useful.
    title: r.stopWorkPush ? 'Time to stop work' : 'Close-out for today',
    body: clip(closeoutText({ closed: closed.map((c) => c.title), open: open.map((o) => o.title), stopWork: r.stopWorkPush, familyStart: r.familyStart }), 230),
    url: '/jarvis/signals',
    tag: `jarvis-stop-${dateKeyIn(r.tz)}`,
  });
}

// Learn when the owner is really active from his own outgoing messages (last 21 days).
export async function learnRhythm() {
  const r = await rhythm();
  const rows = await q(`SELECT "occurredAt" FROM "JarvisInbound" WHERE direction = 'out' AND "occurredAt" > now() - interval '21 days'`);
  if (rows.length < 40) return;
  const mins = rows.map((x) => minutesIn(r.tz, new Date(x.occurredAt))).filter((m) => m >= 4 * 60).sort((a, b) => a - b);
  if (mins.length < 30) return;
  const pick = (p) => mins[Math.min(mins.length - 1, Math.floor(mins.length * p))];
  const hist = new Array(24).fill(0);
  for (const m of mins) hist[Math.floor(m / 60)] += 1;
  const busiest = hist.map((n, h) => [h, n]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${String(h).padStart(2, '0')}:00`);
  await setSetting('rhythm_learned', {
    firstActive: hm(Math.max(5 * 60, pick(0.05) - 15)),
    lastActive: hm(Math.min(23 * 60 + 30, pick(0.97) + 15)),
    busiest,
    sampleSize: mins.length,
    learnedAt: new Date().toISOString(),
  });
}

export async function housekeeping() {
  await q(`DELETE FROM "JarvisInbound" WHERE "occurredAt" < now() - interval '120 days'`);
  await q(`DELETE FROM "JarvisJob" WHERE status IN ('done','failed','cancelled') AND "createdAt" < now() - interval '30 days'`);
  await q(`UPDATE "JarvisSignal" SET status = 'dismissed' WHERE status IN ('new','pushed') AND kind IN ('fyi','plan') AND COALESCE(action->>'type','') <> 'cleanup' AND "createdAt" < now() - interval '3 days'`);
  await expireSignals();
  await nudgeStaleTasks();
}

// Called every minute.
export async function plannerTick() {
  const r = await rhythm();
  const now = minutesIn(r.tz);
  const day = dateKeyIn(r.tz);
  const weekday = weekdayIn(r.tz);
  const wake = parseHm(r.quietEnd, 6 * 60 + 30) + 20;
  if (now >= wake && now < wake + 180) await once(`plan:${day}`, () => morningPlan());
  if (weekday === 'Sunday' && now >= 15 * 60 && now < 16 * 60) await once(`advice-week:${day}`, () => weeklyAdvice());
  const workEnd = parseHm(r.workEnd, 18 * 60);
  if (r.workdays.includes(weekday) && now >= workEnd && now < workEnd + 60) await once(`stop:${day}`, () => eveningCloseout());
  if (now >= 3 * 60 && now < 4 * 60) {
    await once(`learn:${day}`, () => learnRhythm());
    await once(`behaviour:${day}`, () => learnBehaviour());
    await once(`clean:${day}`, () => housekeeping());
    await once(`reconcile:${day}`, () => reconcileOnce({ sinceHours: 24 }));
  }
}
