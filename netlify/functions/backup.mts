import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Weekly offsite backup: stores the full JSON export in Netlify Blobs
// (browsable in the Netlify dashboard under the site's Blobs tab).
// Keeps the last 8 weekly snapshots plus a rolling "latest".
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/backup-export`, {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  if (!res.ok) {
    return new Response(`Export failed: ${res.status}`, { status: 502 });
  }
  const json = await res.text();

  const store = getStore("jarvis-backups");
  const key = `jarvis-${new Date().toISOString().slice(0, 10)}.json`;
  await store.set(key, json);
  await store.set("latest.json", json);

  // Prune to the newest 8 dated snapshots
  const { blobs } = await store.list();
  const dated = blobs
    .map((b) => b.key)
    .filter((k) => k.startsWith("jarvis-"))
    .sort()
    .reverse();
  for (const old of dated.slice(8)) {
    await store.delete(old);
  }

  return new Response(
    JSON.stringify({ ok: true, stored: key, bytes: json.length, kept: Math.min(dated.length, 8) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

export const config: Config = {
  // Sundays at 02:00 UTC.
  schedule: "0 2 * * 0",
};
