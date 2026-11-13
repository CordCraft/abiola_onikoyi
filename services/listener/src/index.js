// Jarvis listener: the always-on half of Jarvis (the site on Netlify is the face).
// Hears WhatsApp, Gmail and Outlook; triages; runs approved actions; plans the day; pushes.
import http from 'node:http';
import crypto from 'node:crypto';
import { config, missing } from './config.js';
import { ensureTables, q, getSetting, probeV3, v3State } from './db.js';
import { every } from './util.js';
import { WhatsApp } from './whatsapp.js';
import { pollGmail } from './gmail.js';
import { pollOutlook } from './outlook.js';
import { triageOnce } from './brain.js';
import { runJobs, attachWhatsApp } from './executor.js';
import { flushHeld } from './push.js';
import { plannerTick, morningPlan } from './planner.js';
import { reconcileOnce, cleanupTick } from './reconcile.js';
import { digestTick } from './digest.js';
import { nudgeTick } from './nudger.js';
import { startHostfullyLoop } from './hostfully.js';

const started = new Date();
const health = { lastTriage: null, lastGmail: null, lastOutlook: null, lastJobs: null, errors: [] };

function note(err) {
  health.errors.unshift({ at: new Date().toISOString(), error: String(err?.message || err).slice(0, 300) });
  health.errors.length = Math.min(health.errors.length, 20);
}

function authorised(req, url) {
  if (!config.adminKey) return false;
  const given = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(config.adminKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function main() {
  const gaps = missing();
  if (gaps.length) console.error(`Missing env: ${gaps.join(', ')}. Jarvis listener will run in a limited mode.`);
  await ensureTables().catch((e) => {
    console.error('table setup failed', e.message);
    note(e);
  });

  // v3 needs columns the site adds; until they exist the v3 loops idle and the old loops run.
  await probeV3();
  every('v3-probe', 5 * 60_000, probeV3, { initialDelayMs: 5 * 60_000 });
  const v3every = (name, ms, fn, opts) => every(name, ms, async () => { if (v3State.ready) await fn(); }, opts);

  const wa = new WhatsApp();
  attachWhatsApp(wa);
  wa.start().catch((e) => {
    console.error('[whatsapp] start failed', e.message);
    note(e);
  });

  // Mail: every 60-120 seconds with jitter, one account at a time.
  every('gmail', 90_000, async () => {
    await pollGmail();
    health.lastGmail = new Date().toISOString();
  }, { initialDelayMs: 15_000 });
  every('outlook', 100_000, async () => {
    await pollOutlook();
    health.lastOutlook = new Date().toISOString();
  }, { initialDelayMs: 25_000 });

  // Triage soon after things arrive, in batches.
  every('triage', 45_000, async () => {
    if (!config.anthropicKey) return;
    let n;
    do {
      n = await triageOnce();
    } while (n >= 30);
    health.lastTriage = new Date().toISOString();
  }, { initialDelayMs: 30_000 });

  // Approved actions run within seconds of the tap.
  every('jobs', 5_000, async () => {
    await runJobs();
    health.lastJobs = new Date().toISOString();
  }, { initialDelayMs: 5_000 });

  every('held-pushes', 10 * 60_000, flushHeld, { initialDelayMs: 60_000 });
  every('planner', 60_000, plannerTick, { initialDelayMs: 20_000 });

  // v3: close loops, propose the one-time clean-up, and bundle held items into a digest.
  v3every('reconcile', 10 * 60_000, () => reconcileOnce({ sinceHours: 6 }), { initialDelayMs: 150_000 });
  v3every('cleanup-proposal', 30 * 60_000, () => cleanupTick(), { initialDelayMs: 120_000 });
  v3every('digest', 10 * 60_000, digestTick, { initialDelayMs: 180_000 });
  // v3 phase 2: threads still waiting on him, and the Hostfully guest-message connector.
  v3every('nudger', 20 * 60_000, nudgeTick, { initialDelayMs: 240_000 });
  startHostfullyLoop().catch((e) => {
    console.error('[hostfully] start failed', e.message);
    note(e);
  });

  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, 'http://local');
      try {
        if (url.pathname === '/health') {
          const wa = await getSetting('whatsapp_status', {});
          const pending = await q(`SELECT count(*)::int AS n FROM "JarvisInbound" WHERE "triagedAt" IS NULL`).catch(() => [{ n: null }]);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, startedAt: started, whatsapp: wa?.state || 'unknown', untriaged: pending[0].n, missingEnv: missing(), v3: v3State, ...health, errors: health.errors.slice(0, 5) }));
          return;
        }
        if (!authorised(req, url)) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        if (url.pathname === '/admin/plan-now' && req.method === 'POST') {
          const r = await morningPlan({ force: true });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(r));
          return;
        }
        if (url.pathname === '/admin') {
          const status = (await getSetting('whatsapp_status', {})) || {};
          const conns = await q(`SELECT provider, account, purpose, status, "lastSyncAt", "lastError" FROM "JarvisConnection" ORDER BY provider, account`);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Jarvis listener</title>
<body style="font-family:system-ui;max-width:640px;margin:24px auto;padding:0 16px;color:#111">
<h1>Jarvis listener</h1>
<p>WhatsApp: <b>${status.state || 'unknown'}</b> ${status.account ? `(+${status.account})` : ''}</p>
${status.qrSvg ? `<p>Scan with WhatsApp on your phone: Settings, Linked devices, Link a device.</p><div style="width:280px">${status.qrSvg}</div>` : ''}
${status.pairingCode ? `<p>Or link with phone number, code: <b style="font-size:24px">${status.pairingCode}</b></p>` : ''}
<h2>Accounts</h2><ul>${conns.map((c) => `<li>${c.provider} ${c.account} (${c.purpose}): ${c.status}${c.lastError ? ` <small style="color:#b00">${String(c.lastError).replace(/</g, '&lt;')}</small>` : ''}</li>`).join('')}</ul>
<h2>Health</h2><pre style="white-space:pre-wrap">${JSON.stringify(health, null, 2).replace(/</g, '&lt;')}</pre></body>`);
          return;
        }
        res.writeHead(404);
        res.end('not found');
      } catch (e) {
        note(e);
        res.writeHead(500);
        res.end('error');
      }
    })
    .listen(config.port, () => console.log(`Jarvis listener on :${config.port}`));
}

process.on('unhandledRejection', (e) => {
  console.error('unhandled', e?.message || e);
  note(e);
});

main();
