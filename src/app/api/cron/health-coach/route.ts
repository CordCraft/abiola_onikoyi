import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToAll } from "@/lib/jarvis/push";
import { getHealthSnapshot, loadRhythmSetting, describeNight } from "@/lib/jarvis/health/data";
import { hmToMinutes, localMinutes } from "@/lib/jarvis/health/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health coach, every 15 minutes:
// - Morning brief once you are up (first phone tap after the night's sleep
//   gap), with last night's sleep, readiness and today's plan.
// - Each plan item that wants a nudge, at its time.
// - A check-in 3 hours after a workout slot if nothing was logged.
// - A steps nudge at the steps check if you are well behind.
// Every push opens the reply screen, so you answer in a line or one tap.
// Nothing is sent in quiet hours, and at most MAX_PER_DAY coach pushes a day.

const MAX_PER_DAY = 8;
const WINDOW_MIN = 20; // cron runs every 15 minutes; tags stop doubles

function inQuiet(nowMin: number, start: number, end: number): boolean {
  return start > end ? nowMin >= start || nowMin < end : nowMin >= start && nowMin < end;
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [rhythm, s] = await Promise.all([loadRhythmSetting(), getHealthSnapshot(now)]);
  const tz = rhythm.tz;
  const nowMin = localMinutes(now, tz);
  const quietStart = hmToMinutes(rhythm.quietStart);
  const quietEnd = hmToMinutes(rhythm.quietEnd);
  if (inQuiet(nowMin, quietStart, quietEnd)) return NextResponse.json({ ok: true, skipped: "quiet hours" });

  const prefix = `health-${s.today}-`;
  const sentToday = await prisma.jarvisNotification.findMany({ where: { tag: { startsWith: prefix } }, select: { tag: true } });
  const sentTags = new Set(sentToday.map((n) => n.tag));
  let budget = MAX_PER_DAY - sentToday.length;
  const sent: string[] = [];

  const push = async (id: string, title: string, body: string, planItem?: string) => {
    const tag = `${prefix}${id}`;
    if (budget <= 0 || sentTags.has(tag)) return;
    const r = await sendPushToAll({ title, body: body.slice(0, 400), url: "/jarvis/health", tag, kind: "health", ref: planItem ? { planItem, day: s.today } : { day: s.today } });
    if (r.sent > 0) {
      budget--;
      sentTags.add(tag);
      sent.push(id);
    }
  };

  // 1. Morning brief: once a wake-up tap is seen, or 90 minutes after quiet hours end.
  const wokeToday = s.lastNight?.wake && s.lastNight.day === s.today;
  if (wokeToday || nowMin >= quietEnd + 90) {
    const next = s.plan.items.filter((i) => i.kind !== "wake" && hmToMinutes(i.at) >= nowMin).slice(0, 3);
    const sleep = s.lastNight?.hours != null || s.lastNight?.healthKitHours != null ? `Slept ${describeNight(s.lastNight, tz).split(" (")[0]}. ` : "";
    await push(
      "brief",
      `Morning: readiness ${s.readiness.score}/100`,
      `${sleep}Today: ${s.plan.focus}. ${next.map((i) => `${i.at} ${i.title}`).join(", ")}. Reply if you want it moved.`,
    );
  }

  const loggedKinds = new Set(s.workouts.filter((w) => w.day === s.today).map((w) => w.kind));

  for (const item of s.plan.items) {
    const at = hmToMinutes(item.at);
    const isWorkout = item.kind === "strength" || item.kind === "run" || item.kind === "rest";
    const logged = item.kind === "rest" ? loggedKinds.size > 0 : loggedKinds.has(item.kind);

    // 2. The item itself, at its time.
    if (item.notify && nowMin >= at && nowMin < at + WINDOW_MIN && !(isWorkout && logged)) {
      await push(item.id, item.title, `${item.detail}${isWorkout ? " Reply Done (with your numbers) when finished." : ""}`, item.id);
    }

    // 3. Check-in 3 hours later if a workout was not logged.
    if (isWorkout && item.notify && !logged && nowMin >= at + 180 && nowMin < at + 180 + WINDOW_MIN) {
      await push(`${item.id}-check`, `Did you get ${item.title} done?`, "Reply Done, Skipped, or tell me when you will fit it in.", item.id);
    }

    // 4. Steps: only when clearly behind.
    if (item.kind === "steps" && nowMin >= at && nowMin < at + WINDOW_MIN) {
      const steps = s.daily[s.today]?.steps;
      if (steps != null && steps < s.profile.stepsTarget * 0.6) {
        await push("steps", `${Math.round(steps).toLocaleString("en-US")} steps so far`, `Target is ${s.profile.stepsTarget.toLocaleString("en-US")}. A 20-minute walk this evening adds about 2,500.`, "steps");
      }
    }
  }

  return NextResponse.json({ ok: true, today: s.today, sent, budgetLeft: budget });
}
