import webpush from 'web-push';
import { config } from './config.js';
import { q, one } from './db.js';
import { rhythm } from './context.js';
import { minutesIn, clip } from './util.js';
import { gateDecision } from './pure.js';

// Push notifications with manners: quiet hours, an hourly and a daily cap, and
// low-value items held back for the digest instead of interrupting.

let ready = false;
function init() {
  if (ready) return true;
  if (!config.vapidPublic || !config.vapidPrivate) return false;
  webpush.setVapidDetails('mailto:abiolaonikoyi@gmail.com', config.vapidPublic, config.vapidPrivate);
  ready = true;
  return true;
}

// Without VAPID keys here, notifications go through the site (/api/jarvis-push), which holds them.
async function sendViaSite(payload) {
  if (!config.adminKey) return { sent: 0, skipped: 'no VAPID keys and no LISTENER_ADMIN_KEY' };
  const res = await fetch(`${config.siteUrl}/api/jarvis-push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-listener-key': config.adminKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`site push ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return { sent: Number(json.sent || 0) };
}

export async function sendPush(payload) {
  if (!init()) return sendViaSite(payload);
  const subs = await q(`SELECT endpoint, p256dh, auth FROM "JarvisPushSubscription"`);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 * 12, urgency: payload.urgent ? 'high' : 'normal' });
      sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await q(`DELETE FROM "JarvisPushSubscription" WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
      else console.error('[push] send failed', e.statusCode || e.message);
    }
  }
  return { sent };
}

export async function mayInterrupt(score) {
  const r = await rhythm();
  const counts = await one(
    `SELECT count(*) FILTER (WHERE "pushedAt" > now() - interval '1 hour')::int AS hour,
            count(*) FILTER (WHERE "pushedAt" > now() - interval '24 hours')::int AS day
     FROM "JarvisSignal" WHERE "pushedAt" IS NOT NULL`,
  );
  return gateDecision(r, { nowMin: minutesIn(r.tz), score, counts });
}

const VERB = {
  calendar_event: 'Add to calendar?',
  create_task: 'Make it a task?',
  send_reply: 'Send the reply I drafted?',
};

export async function pushSignal(id, { force = false } = {}) {
  const s = await one(`SELECT * FROM "JarvisSignal" WHERE id = $1`, [id]);
  if (!s || !['new', 'snoozed'].includes(s.status)) return;
  if (!force) {
    const gate = await mayInterrupt(s.score);
    if (!gate.ok) return;
  }
  const ask = s.action?.type ? VERB[s.action.type] || '' : '';
  const res = await sendPush({
    title: clip(s.title, 80),
    body: clip([s.detail, ask].filter(Boolean).join(' '), 230),
    url: `/jarvis/signals/${s.id}`,
    tag: `jarvis-signal-${s.id}`,
    signalId: s.id,
    urgent: s.score >= 85,
    actions: s.action?.type ? [{ action: 'approve', title: 'Do it' }, { action: 'dismiss', title: 'Not now' }] : [],
  });
  if (res.sent) await q(`UPDATE "JarvisSignal" SET status = 'pushed', "pushedAt" = now(), "updatedAt" = now() WHERE id = $1`, [s.id]);
}

// Signals that were held back (quiet hours, caps) get a second chance once the window opens.
export async function flushHeld() {
  const held = await q(
    `SELECT id FROM "JarvisSignal" WHERE status = 'new' AND kind <> 'fyi' AND "pushedAt" IS NULL
       AND autonomy = 'ask' AND score >= 60 AND "createdAt" > now() - interval '18 hours'
     ORDER BY score DESC LIMIT 3`,
  );
  for (const h of held) await pushSignal(h.id);
  // Snoozed signals come back when their time is up.
  const woke = await q(`SELECT id FROM "JarvisSignal" WHERE status = 'snoozed' AND "snoozeUntil" <= now() LIMIT 5`);
  for (const w of woke) {
    await q(`UPDATE "JarvisSignal" SET status = 'new', "snoozeUntil" = NULL WHERE id = $1`, [w.id]);
    await pushSignal(w.id);
  }
}
