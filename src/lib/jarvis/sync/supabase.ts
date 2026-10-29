import "server-only";
import { prisma } from "@/lib/prisma";
import { recordActivity, resolveProjectId } from "./store";
import type { SourceResult } from "./util";

type SbProject = {
  id: string; // project ref
  name: string;
  status: string; // ACTIVE_HEALTHY | INACTIVE (paused) | COMING_UP | ...
  region: string;
  created_at: string;
};

/**
 * One row per Supabase project holding its current status. The row's time
 * only moves when the status changes, so "paused for 5 days" stays visible.
 */
export async function syncSupabase(): Promise<SourceResult> {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    return { source: "supabase", skipped: "SUPABASE_ACCESS_TOKEN not set" };
  }
  const res = await fetch("https://api.supabase.com/v1/projects", {
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Supabase: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const projects = (await res.json()) as SbProject[];

  let added = 0;
  for (const p of projects) {
    const externalId = `supabase:project:${p.id}`;
    const prev = await prisma.jarvisActivity.findUnique({ where: { externalId } });
    if (prev && prev.state === p.status) continue;
    const projectId = await resolveProjectId("supabase", p.name);
    const paused = p.status === "INACTIVE";
    if (
      await recordActivity({
        source: "supabase",
        kind: "db_project",
        externalId,
        subject: p.name,
        title: paused
          ? `Supabase database "${p.name}" is PAUSED`
          : `Supabase database "${p.name}" is ${p.status.toLowerCase().replace(/_/g, " ")}`,
        detail: `ref ${p.id}, region ${p.region}`,
        url: `https://supabase.com/dashboard/project/${p.id}`,
        state: p.status,
        // A status change is news; the very first sighting is backdated to
        // creation so it does not flood "recent activity".
        projectId: paused ? null : projectId,
        occurredAt: prev ? new Date() : new Date(p.created_at),
      })
    )
      added++;
    // Keep the project link even for paused databases (without bumping the
    // project's activity clock).
    if (paused && projectId) {
      await prisma.jarvisActivity.update({ where: { externalId }, data: { projectId } });
    }
  }
  return { source: "supabase", ok: true, added, scanned: projects.length };
}
