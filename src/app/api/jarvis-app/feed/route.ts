import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { phoneAuthorised } from "@/lib/jarvis/phone-auth";
import { getHealthSnapshot } from "@/lib/jarvis/health/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Home screen of the native app: today's plan, readiness, last night's sleep
// and the latest notifications (so missed ones can still be answered).
export async function GET(req: Request) {
  if (!(await phoneAuthorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await ensureCompanionTables();
  const [s, notifications] = await Promise.all([
    getHealthSnapshot(),
    prisma.jarvisNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, title: true, body: true, kind: true, createdAt: true, openedAt: true, threadId: true },
    }),
  ]);
  return NextResponse.json({
    today: s.today,
    focus: s.plan.focus,
    readiness: s.readiness,
    sleep: s.lastNight ? { hours: s.lastNight.healthKitHours ?? s.lastNight.hours, bedtime: s.lastNight.bedtime, wake: s.lastNight.wake, note: s.lastNight.note ?? null } : null,
    sleepAvg7: s.sleepAvg7,
    steps: s.daily[s.today]?.steps ?? null,
    stepsTarget: s.profile.stepsTarget,
    week: { strength: s.weekStrength, runs: s.weekRuns, strengthTarget: s.profile.strengthDays.length },
    plan: s.plan.items.map((i) => ({ id: i.id, at: i.at, title: i.title, detail: i.detail, kind: i.kind })),
    notifications,
  });
}
