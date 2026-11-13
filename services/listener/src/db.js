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
      if (e.code !== '42501' && e.code !== '42P07' && e.code !== '42P01') throw e;
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
