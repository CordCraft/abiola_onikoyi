#!/usr/bin/env node
// Read-only preview of Jarvis's one-time clean-up proposal (the deterministic part only).
//
// Prints which open reply/follow-up signals already have an outgoing message of his on the same
// thread (they would be closed), and which open tasks are duplicates of each other (they would
// be merged). No model is called and nothing is written: every statement is a SELECT, the
// session is set to default_transaction_read_only, and the whole run is one READ ONLY transaction.
//
// Usage (from the repo root, after `npm install` inside services/listener):
//   DATABASE_URL=postgres://... node scripts/jarvis-cleanup-report.mjs [--json]
// Point DATABASE_URL at a copy or at production: either way it cannot change anything.
import { createRequire } from 'node:module';
import { selectDeterministicCloses, findDuplicateGroups } from '../services/listener/src/pure.js';

const require = createRequire(new URL('../services/listener/package.json', import.meta.url));
const pg = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL first. This script only reads.');
  process.exit(2);
}
const asJson = process.argv.includes('--json');

const client = new pg.Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  options: '-c default_transaction_read_only=on',
});

// Belt and braces: refuse to send anything that is not a read.
const ALLOWED = /^\s*(select|set default_transaction_read_only|begin read only|rollback)\b/i;
async function q(text, params = []) {
  if (!ALLOWED.test(text)) throw new Error(`refusing to run a non-read statement: ${text.slice(0, 40)}`);
  return (await client.query(text, params)).rows;
}

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}...` : String(s || ''));

await client.connect();
try {
  await q('SET default_transaction_read_only = on');
  await q('BEGIN READ ONLY');

  const signals = await q(
    `SELECT * FROM "JarvisSignal" WHERE status = ANY($1) AND kind <> 'plan' AND COALESCE(action->>'type','') <> 'cleanup' ORDER BY "createdAt" DESC`,
    [['new', 'pushed', 'snoozed']],
  );
  const tasks = await q(`SELECT id, title, priority, "threadKey", "createdAt" FROM "JarvisTask" WHERE status <> 'done' ORDER BY "createdAt" DESC`);

  // When each signal's triggering message arrived (falls back to the signal's own creation time).
  const candidates = signals.filter((s) => ['reply', 'followup'].includes(s.kind) && s.threadKey);
  const ids = [...new Set(candidates.flatMap((s) => (Array.isArray(s.inboundIds) ? s.inboundIds : [])))];
  const times = new Map();
  if (ids.length) for (const r of await q(`SELECT id, "occurredAt" FROM "JarvisInbound" WHERE id = ANY($1)`, [ids])) times.set(r.id, new Date(r.occurredAt).getTime());
  const withSince = candidates.map((s) => {
    const t = (Array.isArray(s.inboundIds) ? s.inboundIds : []).map((i) => times.get(i)).filter(Boolean);
    return { ...s, since: t.length ? new Date(Math.max(...t)) : s.createdAt };
  });
  const keys = [...new Set(withSince.map((s) => s.threadKey))];
  const outgoing = keys.length
    ? await q(`SELECT "threadKey", "occurredAt", body FROM "JarvisInbound" WHERE direction = 'out' AND "threadKey" = ANY($1) AND "occurredAt" > now() - interval '60 days'`, [keys])
    : [];
  const closes = selectDeterministicCloses(withSince, outgoing).map(({ signal, outgoing: o }) => ({
    type: 'signal', id: signal.id, title: signal.title, evidence: `You replied: ${clip(o.body, 140)}`,
  }));

  const merge = findDuplicateGroups(tasks);
  const mergeCount = merge.reduce((n, g) => n + g.drop.length, 0);
  await q('ROLLBACK');

  if (asJson) {
    console.log(JSON.stringify({ openSignals: signals.length, openTasks: tasks.length, close: closes, merge }, null, 2));
  } else {
    console.log(`Open signals: ${signals.length}   Open tasks: ${tasks.length}`);
    console.log(`\nClean-up: I can close ${closes.length} items you've already done and merge ${mergeCount} duplicates\n`);
    for (const c of closes) console.log(`  Close: ${clip(c.title, 90)}\n         ${c.evidence}`);
    for (const g of merge) {
      console.log(`  Keep:  ${clip(g.keep.title, 90)}`);
      for (const d of g.drop) console.log(`    merge ${clip(d.title, 86)}`);
    }
    console.log('\n(Deterministic part only: the model-based closes are added by the listener. Nothing was written.)');
  }
} finally {
  await client.end();
}
