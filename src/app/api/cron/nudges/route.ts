import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToAll } from "@/lib/jarvis/push";
import { STALE_DAYS } from "@/lib/jarvis/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Midday nudge: tasks due today/tomorrow and projects that crossed the stall
// line in the last day. Runs once a day, so nothing repeats within a day.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
  endOfTomorrow.setHours(0, 0, 0, 0);

  const staleLine = new Date(now.getTime() - STALE_DAYS * 864e5);
  const staleLineYesterday = new Date(staleLine.getTime() - 864e5);

  const [dueTasks, newlyStalled] = await Promise.all([
    prisma.jarvisTask.findMany({
      where: { status: { not: "done" }, dueDate: { lte: endOfTomorrow } },
      orderBy: { dueDate: "asc" },
      take: 6,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisProject.findMany({
      where: {
        status: "active",
        priority: "high",
        lastActivityAt: { lte: staleLine, gt: staleLineYesterday },
      },
      take: 3,
    }),
  ]);

  if (!dueTasks.length && !newlyStalled.length) {
    return NextResponse.json({ ok: true, skipped: "Nothing needs a nudge today" });
  }

  const day = now.toISOString().slice(0, 10);
  const results = [];

  // Up to 3 individual task notifications with Mark done / Snooze buttons.
  const individual = dueTasks.slice(0, 3);
  for (const t of individual) {
    const overdue = t.dueDate && t.dueDate.getTime() < now.getTime();
    results.push(
      await sendPushToAll({
        title: overdue ? "Overdue task" : "Due soon",
        body: `${t.title}${t.project ? ` (${t.project.name})` : ""}`,
        url: t.projectId ? `/jarvis/projects/${t.projectId}` : "/jarvis",
        tag: `jarvis-task-${t.id}-${day}`,
        taskId: t.id,
        actions: [
          { action: "done", title: "Mark done" },
          { action: "snooze", title: "Snooze 1 day" },
        ],
      }),
    );
  }

  // Everything else rolls into one summary.
  const rest: string[] = [];
  for (const t of dueTasks.slice(3)) {
    rest.push(`Due: ${t.title}`);
  }
  for (const p of newlyStalled) {
    rest.push(`Stalled: ${p.name} (${STALE_DAYS} days quiet)`);
  }
  if (rest.length) {
    results.push(
      await sendPushToAll({
        title: `Jarvis: ${rest.length} more need attention`,
        body: rest.slice(0, 4).join("\n").slice(0, 240),
        url: "/jarvis",
        tag: `jarvis-nudge-${day}`,
      }),
    );
  }

  const sent = results.reduce((a, r) => a + r.sent, 0);
  return NextResponse.json({ ok: true, notifications: results.length, sent });
}
