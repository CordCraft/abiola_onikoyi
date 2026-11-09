import { q, getSetting } from './db.js';
import { config } from './config.js';
import { listEvents } from './calendar.js';

// The owner's world, compact enough to put in front of the model on every triage call.

export const DEFAULT_RHYTHM = {
  tz: config.defaultTz,
  workdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  workStart: '08:00',
  workEnd: '18:00',
  familyStart: '18:30',
  familyEnd: '21:30',
  quietStart: '22:30',
  quietEnd: '06:30',
  maxPushesPerDay: 15,
  maxPushesPerHour: 4,
};

export async function rhythm() {
  const saved = (await getSetting('rhythm', {})) || {};
  const learned = (await getSetting('rhythm_learned', {})) || {};
  return { ...DEFAULT_RHYTHM, ...learnedDefaults(learned), ...saved, learned };
}

function learnedDefaults(l) {
  // Learned hours only fill in where the owner has not set something explicitly.
  const out = {};
  if (l.firstActive) out.quietEnd = l.firstActive;
  if (l.lastActive) out.quietStart = l.lastActive;
  return out;
}

export async function goalsAndProjects() {
  const [goals, projects, ventures] = await Promise.all([
    q(`SELECT g.id, g.title, g.horizon, g."targetDate",
         COALESCE((SELECT json_agg(json_build_object('title', m.title, 'done', m.done, 'due', m."dueDate"))
           FROM "JarvisMilestone" m WHERE m."goalId" = g.id), '[]') AS milestones
       FROM "JarvisGoal" g WHERE g.status = 'active' ORDER BY g."createdAt"`).catch(() => []),
    q(`SELECT p.id, p.name, p.status, p.priority, p.summary, v.name AS venture, p."lastActivityAt"
       FROM "JarvisProject" p LEFT JOIN "JarvisVenture" v ON v.id = p."ventureId"
       WHERE p.status IN ('active','stalled','idea') ORDER BY p.priority = 'high' DESC, p."lastActivityAt" DESC LIMIT 40`).catch(() => []),
    q(`SELECT name, description FROM "JarvisVenture" WHERE status = 'active'`).catch(() => []),
  ]);
  return { goals, projects, ventures };
}

export async function people(limit = 60) {
  return q(`SELECT key, name, relation, org, importance FROM "JarvisPerson" ORDER BY importance DESC, "lastInboundAt" DESC NULLS LAST LIMIT $1`, [limit]).catch(() => []);
}

export async function openSignals(days = 7) {
  return q(
    `SELECT id, kind, title, status FROM "JarvisSignal"
     WHERE "createdAt" > now() - ($1 || ' days')::interval AND status IN ('new','pushed','snoozed','approved')
     ORDER BY "createdAt" DESC LIMIT 60`,
    [String(days)],
  ).catch(() => []);
}

export async function upcoming(days = 7) {
  const from = new Date(Date.now() - 2 * 3600e3);
  const to = new Date(Date.now() + days * 864e5);
  return listEvents(from, to).catch(() => []);
}

export function fmtEvents(events, tz) {
  if (!events.length) return '(no events)';
  return events
    .slice(0, 60)
    .map((e) => {
      const when = e.allDay
        ? `${String(e.start).slice(0, 10)} all day`
        : new Date(e.start).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `- ${when} | ${e.title}${e.location ? ` @ ${e.location}` : ''} [${e.purpose} calendar]`;
    })
    .join('\n');
}

export const OWNER_BRIEF = `The owner is ${config.ownerName}: an engineer and founder who works between Kuwait and Dhahran (Saudi Arabia), Sunday to Thursday. Long-term goal: build to USD 1 million through his ventures. Known ventures and projects include HopperTax (tax and accounting platform, agents and accountants), Nikstalis (data centre pilot rack in Kigali, compute and payments), NEPL OCTG supply (casing and tubing to NNPC E&P), Nikstalis Airbnb / EraView short-stay flats in Bahrain (Reply Guard), Onterra (IELTS tutor and Onterra Nigeria), a Nigeria PEL and frontier oil and gas venture, MT5 algo trading, a mentorship programme for UNILAG chemical engineering students, and his personal site. He wants protected family time every day and to stop work at a sensible hour.`;
