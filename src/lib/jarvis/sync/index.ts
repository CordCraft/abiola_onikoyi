import "server-only";
import { ensureSyncTables } from "./setup";
import { getSetting, setSetting } from "./store";
import { syncGithub } from "./github";
import { syncNetlify } from "./netlify";
import { syncSupabase } from "./supabase";
import type { SourceResult } from "./util";
import { getAlerts } from "./digest";
import { sendPushToAll } from "@/lib/jarvis/push";

export type { SyncStatus } from "./store";
import type { SyncStatus } from "./store";
export { getSyncStatus } from "./store";

const FIRST_RUN_DAYS = 14;
const OVERLAP_MS = 2 * 3600_000; // re-read the last 2h each run; writes are idempotent

/** Pulls GitHub, Netlify and Supabase into JarvisActivity. Safe to run often. */
export async function runSync(): Promise<SyncStatus> {
  await ensureSyncTables();
  const last = await getSetting("sync_last_run");
  const since = last
    ? new Date(new Date(last).getTime() - OVERLAP_MS)
    : new Date(Date.now() - FIRST_RUN_DAYS * 864e5);

  const settled = await Promise.allSettled([syncGithub(since), syncNetlify(since), syncSupabase()]);
  const names = ["github", "netlify", "supabase"];
  const results: SourceResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { source: names[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  );

  const status: SyncStatus = { at: new Date().toISOString(), results };
  await setSetting("sync_status", JSON.stringify(status));
  // Only move the cursor forward when nothing failed, so a bad run is retried.
  if (results.every((r) => !r.error)) await setSetting("sync_last_run", status.at);
  await notifyNewAlerts().catch((err) => console.error("alert push failed", err));
  return status;
}

/**
 * Pushes each alert to the phone once, when it first appears. Ongoing ones
 * are repeated by the morning briefing (they sit in the context snapshot).
 */
async function notifyNewAlerts(): Promise<void> {
  const alerts = await getAlerts();
  let known: string[] = [];
  try {
    known = JSON.parse((await getSetting("sync_alerts_sent")) ?? "[]");
  } catch {}
  const fresh = alerts.filter((a) => !known.includes(a.key));
  // Remember only alerts that still exist, so a recurrence is pushed again.
  await setSetting("sync_alerts_sent", JSON.stringify(alerts.map((a) => a.key)));
  if (!fresh.length) return;
  await sendPushToAll({
    title: fresh.length === 1 ? "Jarvis: needs attention" : `Jarvis: ${fresh.length} things need attention`,
    body: fresh.map((a) => a.text).join("\n").slice(0, 240),
    url: "/jarvis/activity",
    tag: `jarvis-alerts-${Date.now()}`,
  });
}
