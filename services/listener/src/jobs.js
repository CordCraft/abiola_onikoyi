import { q, newId } from './db.js';

// The job queue shared with the site: the site (push buttons, chat tools) inserts jobs with
// target "listener"; this service claims and runs them. Computers use target "machine:<id>".

export async function enqueue(kind, payload, target = 'listener') {
  const id = newId();
  await q(`INSERT INTO "JarvisJob" (id, kind, target, payload) VALUES ($1, $2, $3, $4)`, [id, kind, target, JSON.stringify(payload)]);
  return id;
}

// Atomically claim the next queued listener job (safe even if two instances ever run).
export async function claim() {
  const rows = await q(
    `UPDATE "JarvisJob" SET status = 'running', "startedAt" = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM "JarvisJob" WHERE target = 'listener' AND status = 'queued'
       ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
  );
  return rows[0] || null;
}

export async function finish(id, result) {
  await q(`UPDATE "JarvisJob" SET status = 'done', result = $2, "finishedAt" = now(), error = NULL WHERE id = $1`, [id, JSON.stringify(result ?? {})]);
}

export async function fail(id, error, retry = false) {
  await q(
    `UPDATE "JarvisJob" SET status = CASE WHEN $3 AND attempts < 3 THEN 'queued' ELSE 'failed' END, error = $2, "finishedAt" = now() WHERE id = $1`,
    [id, String(error).slice(0, 500), retry],
  );
}

export async function cancel(id, reason) {
  await q(`UPDATE "JarvisJob" SET status = 'cancelled', error = $2, "finishedAt" = now() WHERE id = $1`, [id, String(reason).slice(0, 500)]);
}

// Jobs stuck in "running" after a restart are put back.
export async function recoverStuck() {
  await q(`UPDATE "JarvisJob" SET status = 'queued' WHERE target = 'listener' AND status = 'running' AND "startedAt" < now() - interval '10 minutes' AND attempts < 3`);
}
