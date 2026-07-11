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

  const lines: string[] = [];
  for (const t of dueTasks) {
    const overdue = t.dueDate && t.dueDate.getTime() < now.getTime();
    lines.push(`${overdue ? "Overdue" : "Due soon"}: ${t.title}${t.project ? ` (${t.project.name})` : ""}`);
  }
  for (const p of newlyStalled) {
    lines.push(`Stalled: ${p.name} has had no activity for ${STALE_DAYS} days`);
  }

  const result = await sendPushToAll({
    title: lines.length === 1 ? "Jarvis nudge" : `Jarvis: ${lines.length} things need attention`,
    body: lines.slice(0, 4).join("\n").slice(0, 240),
    url: "/jarvis",
    tag: `jarvis-nudge-${now.toISOString().slice(0, 10)}`,
  });

  return NextResponse.json({ ok: true, items: lines.length, ...result });
}
