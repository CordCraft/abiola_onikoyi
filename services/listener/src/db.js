import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';

// One small pool. Supabase pooler strings work; the long-lived service never needs many connections.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 4),
  idleTimeoutMillis: 30_000,
  ssl: config.databaseUrl && !/localhost|127\.0\.0\.1/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (e) => console.error('pg pool error', e.message));

export async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
export async function one(text, params = []) {
  return (await q(text, params))[0] || null;
}

// Prisma uses cuid ids; any unique text works, so a short random id is fine here.
export function newId() {
  return 'c' + crypto.randomBytes(12).toString('hex');
}

// Same tables the site creates lazily (src/lib/jarvis/v2/setup.ts); idempotent.
export async function ensureTables() {
  const ddl = fs.readFileSync(new URL('./ddl.sql', import.meta.url), 'utf8');
  for (const stmt of ddl.split(/;\s*\n?/).map((s) => s.trim()).filter(Boolean)) {
    try {
      await pool.query(stmt);
    } catch (e) {
      // The listener's own database login does not own the tables (the site does), so
      // owner-only statements such as ENABLE ROW LEVEL SECURITY are refused. That is fine.
      // 42703 (undefined column) on an index means the column add above it was refused for the
      // same reason; the v3 probe below keeps the v3 loops idle until the site adds the columns.
      const indexStmt = /^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt);
      if (e.code !== '42501' && e.code !== '42P07' && e.code !== '42P01' && !(indexStmt && e.code === '42703')) throw e;
    }
  }
}

export async function getSetting(key, fallback = null) {
  const row = await one('SELECT value FROM "JarvisSetting" WHERE key = $1', [key]).catch(() => null);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export async function setSetting(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await q(
    `INSERT INTO "JarvisSetting" (key, value, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [key, v],
  );
}

// ---------- v3 readiness ----------
// The v3 loops need columns and a table that the site (the table owner) adds when /jarvis is
// opened after a deploy. Until they exist the v3 loops stay idle and the old loops keep running.
export const v3State = { ready: false, missing: [], checkedAt: null };

const V3_NEEDS = [
  ['JarvisSignal', 'threadKey'],
  ['JarvisSignal', 'resolvedAt'],
  ['JarvisSignal', 'expiresAt'],
  ['JarvisTask', 'sourceSignalId'],
  ['JarvisTask', 'threadKey'],
  ['JarvisTask', 'closedBy'],
  ['JarvisLedger', 'id'],
];

export async function probeV3() {
  try {
    const rows = await q(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN ('JarvisSignal','JarvisTask','JarvisLedger')`,
    );
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = V3_NEEDS.filter(([t, c]) => !have.has(`${t}.${c}`)).map(([t, c]) => (c === 'id' ? `table ${t}` : `${t}.${c}`));
    const was = v3State.ready;
    v3State.ready = missing.length === 0;
    v3State.missing = missing;
    v3State.checkedAt = new Date().toISOString();
    if (!v3State.ready) console.error(`[v3] NOT READY, v3 loops idle (reconcile, cleanup, digest, nudger, learn, advisor). Missing: ${missing.join(', ')}. Open /jarvis once on the site so ensureV2Tables adds them; re-checking every 5 minutes.`);
    else if (!was) console.log('[v3] schema ready, v3 loops running');
  } catch (e) {
    v3State.ready = false;
    console.error('[v3] probe failed, v3 loops idle:', e.message);
  }
  return v3State.ready;
}
