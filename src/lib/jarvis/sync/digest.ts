import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureSyncTables } from "./setup";
import { getSyncStatus } from "./store";

export type Alert = { key: string; text: string; url?: string | null };

const PR_STALE_DAYS = 3;

/** Things that need you: failed deploys, paused databases, waiting PRs. */
export async function getAlerts(): Promise<Alert[]> {
  await ensureSyncTables();
  const [deploys, dbs, prs] = await Promise.all([
    prisma.jarvisActivity.findMany({
      where: { source: "netlify", kind: "deploy", occurredAt: { gt: new Date(Date.now() - 14 * 864e5) } },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.jarvisActivity.findMany({ where: { source: "supabase", state: "INACTIVE" } }),
    prisma.jarvisActivity.findMany({
      where: {
        source: "github",
        kind: "pr",
        state: "open",
        occurredAt: { lt: new Date(Date.now() - PR_STALE_DAYS * 864e5) },
      },
      orderBy: { occurredAt: "asc" },
      take: 5,
    }),
  ]);

  const alerts: Alert[] = [];
  // Only the newest finished deploy per site counts: a later success clears it.
  const seen = new Set<string>();
  for (const d of deploys) {
    if (seen.has(d.subject) || !["ready", "error"].includes(d.state ?? "")) continue;
    seen.add(d.subject);
    if (d.state === "error") {
      alerts.push({ key: `deploy-${d.externalId}`, text: `Netlify deploy failing on ${d.subject}: ${d.title}`, url: d.url });
    }
  }
  for (const db of dbs) {
    alerts.push({ key: `db-${db.externalId}`, text: `Supabase database "${db.subject}" is paused`, url: db.url });
  }
  for (const pr of prs) {
    const days = Math.floor((Date.now() - pr.occurredAt.getTime()) / 864e5);
    alerts.push({ key: `pr-${pr.externalId}`, text: `${pr.subject} ${pr.title} has been open ${days} days`, url: pr.url });
  }
  return alerts;
}

/** Markdown section for the chat / briefing context. Never throws. */
export async function buildActivitySection(days = 3): Promise<string> {
  try {
    await ensureSyncTables();
    const since = new Date(Date.now() - days * 864e5);
    const [rows, alerts, status] = await Promise.all([
      prisma.jarvisActivity.findMany({
        where: { occurredAt: { gt: since } },
        orderBy: { occurredAt: "desc" },
        take: 200,
      }),
      getAlerts(),
      getSyncStatus(),
    ]);
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[];
    const projects = projectIds.length
      ? await prisma.jarvisProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
      : [];
    const pname = new Map(projects.map((p) => [p.id, p.name]));

    const lines: string[] = [];
    lines.push("\n## Alerts from connected systems (raise these with the user)");
    if (!alerts.length) lines.push("(none)");
    for (const a of alerts) lines.push(`- ${a.text}`);

    lines.push(
      `\n## Live work activity, last ${days} days (synced automatically from GitHub, Netlify, Supabase and Claude Code; use get_activity for more)`,
    );
    if (status) {
      const bad = status.results.filter((r) => r.error || r.skipped).map((r) => `${r.source}: ${r.error ?? r.skipped}`);
      lines.push(`Last sync ${status.at}${bad.length ? `; not connected or failing: ${bad.join("; ")}` : ""}`);
    }
    if (!rows.length) lines.push("(no activity recorded)");

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.projectId ? `project ${pname.get(r.projectId) ?? r.subject}` : r.subject;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [k, items] of [...groups.entries()].slice(0, 15)) {
      const commits = items.filter((i) => i.kind === "commit");
      const deploys = items.filter((i) => i.kind === "deploy");
      const sessions = items.filter((i) => i.kind === "session");
      const bits = [
        commits.length ? `${commits.length} commits` : "",
        deploys.length ? `${deploys.length} deploys (latest ${deploys[0].state})` : "",
        sessions.length ? `${sessions.length} Claude Code sessions` : "",
      ].filter(Boolean);
      lines.push(`- ${k}: ${bits.join(", ") || items[0].title}`);
      for (const c of commits.slice(0, 3)) lines.push(`  commit: ${c.title}`);
      for (const s of sessions.slice(0, 2)) {
        const latest = s.detail?.split("Latest from Claude:\n")[1]?.replace(/\s+/g, " ").slice(0, 300);
        lines.push(`  session: ${s.title}${latest ? ` | ended with: ${latest}` : ""}`);
      }
    }
    return lines.join("\n");
  } catch (err) {
    console.error("activity section failed", err);
    return "";
  }
}
