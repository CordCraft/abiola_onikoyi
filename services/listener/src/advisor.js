import { config } from './config.js';
import { q, newId, getSetting, setSetting } from './db.js';
import { structured } from './llm.js';
import { rhythm, behaviour, upcoming, fmtEvents, OWNER_BRIEF } from './context.js';
import { pushSignal } from './push.js';
import { clip } from './util.js';
import { parseAdvice, adviceText, behaviourText } from './pure.js';

// Opus reads the last week of what got done, what is still open, how he behaves and the
// next three days, then offers 3 to 5 concrete ways to work faster or catch dropped balls.

export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'how'],
        properties: { title: { type: 'string' }, why: { type: 'string' }, how: { type: 'string' } },
      },
    },
  },
};

const RULES = `You are Jarvis advising the owner on how to work faster and drop fewer balls. From the evidence give 3 to 5 CONCRETE suggestions, each grounded in something you can see below (a repeated manual task, a pattern in the ledger, something overdue, a slow reply habit, a crowded calendar). No generic productivity advice.
title: the suggestion in under 12 words. why: the evidence, one or two sentences with real numbers or names. how: the exact first step he can take (a setting, a template, a rule, a delegation, a time block). Never use em dashes.`;

export async function adviseOnce({ mode = 'daily' } = {}) {
  if (!config.anthropicKey && !globalThis.__jarvisFakeStructured) return null;
  const r = await rhythm();
  const [ledger, signals, tasks, learned, events] = await Promise.all([
    q(`SELECT kind, title, "closedBy", "closedAt" FROM "JarvisLedger" WHERE "closedAt" > now() - interval '7 days' ORDER BY "closedAt" DESC LIMIT 80`).catch(() => []),
    q(`SELECT kind, title, score, "createdAt" FROM "JarvisSignal" WHERE status IN ('new','pushed','snoozed') AND kind <> 'plan' ORDER BY score DESC LIMIT 25`),
    q(`SELECT title, priority, "dueDate", "updatedAt" FROM "JarvisTask" WHERE status <> 'done' ORDER BY "dueDate" NULLS LAST LIMIT 25`),
    behaviour(),
    upcoming(3),
  ]);
  const by = {};
  for (const l of ledger) by[l.closedBy || 'unknown'] = (by[l.closedBy || 'unknown'] || 0) + 1;
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const user = [
    `Today: ${new Date().toLocaleString('en-GB', { timeZone: r.tz, dateStyle: 'full' })} (${r.tz}). Review type: ${mode === 'weekly' ? 'Sunday weekly review' : 'morning'}.`,
    `Done in the last 7 days (${ledger.length}; closed by ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'nobody'}):\n${ledger.map((l) => `- [${l.kind}/${l.closedBy}] ${clip(l.title, 110)}`).join('\n') || '(nothing)'}`,
    `Open signals (kind | score | title | since):\n${signals.map((s) => `- ${s.kind} | ${s.score} | ${clip(s.title, 110)} | ${day(s.createdAt)}`).join('\n') || '(none)'}`,
    `Open tasks (priority | due | last touched | title):\n${tasks.map((t) => `- ${t.priority} | ${day(t.dueDate) || 'no date'} | ${day(t.updatedAt)} | ${clip(t.title, 110)}`).join('\n') || '(none)'}`,
    `How he works:\n${behaviourText(learned) || '(not learned yet)'}`,
    `Calendar next 3 days:\n${fmtEvents(events, r.tz)}`,
  ].join('\n\n');
  const result = await structured({ model: config.plannerModel, system: `${OWNER_BRIEF}\n\n${RULES}`, user, schema: ADVICE_SCHEMA, effort: 'medium' });
  const items = parseAdvice(result);
  if (!items.length) return null;
  const advice = { generatedAt: new Date().toISOString(), mode, items };
  await setSetting('advice', advice);
  return advice;
}

// The top suggestion as one line for the morning plan.
export async function topAdviceLine() {
  const a = await getSetting('advice', null);
  const top = a?.items?.[0];
  return top ? `Idea: ${top.title}. ${top.why}` : '';
}

// Sunday 15:00: the full list as one "Ideas for this week" card (the push gate still applies).
export async function weeklyAdvice() {
  const advice = await adviseOnce({ mode: 'weekly' });
  if (!advice) return null;
  const id = newId();
  await q(
    `INSERT INTO "JarvisSignal" (id, kind, title, detail, why, score, source, autonomy, status, "updatedAt")
     VALUES ($1,'plan','Ideas for this week',$2,'Drawn from your last 7 days, open loops and calendar', 60, 'advisor','ask','new', now())`,
    [id, adviceText(advice.items)],
  );
  await pushSignal(id).catch((e) => console.error('[advisor] push', e.message));
  return { id, items: advice.items.length };
}
