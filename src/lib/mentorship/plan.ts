import "server-only";
import { prisma } from "@/lib/prisma";
import {
  PROGRAM_WEEKS,
  lagosDate,
  planDayIndex,
  weekOfPlanDay,
} from "@/lib/mentorship/constants";
import type { MentorshipPlanDay, MentorshipPlanTask } from "@prisma/client";

export type PlanDayWithTasks = MentorshipPlanDay & {
  tasks: MentorshipPlanTask[];
};

export type PlanState = {
  days: PlanDayWithTasks[];
  hasPlan: boolean;
  todayIndex: number; // 0 before the programme, PROGRAM_DAYS+1 after
  currentWeek: number; // week the calendar says we are in (1..13, clamped)
  unlockedWeek: number; // highest week the mentee may work in
  visibleWeek: number; // highest week shown (unlocked + 1 preview)
  streak: number; // consecutive closed-out days ending today/yesterday
  pointsEarned: number;
  pointsTotal: number;
  tasksDone: number;
  tasksTotal: number;
};

// Week gating: week 1 opens with the programme. Week N opens once the
// calendar has reached it AND the week N-1 check-in was submitted. The
// mentor's reply is never required to proceed; submitting the reflection is
// what turns the key. The next locked week stays visible as a preview.
export function computeUnlockedWeek(
  currentWeek: number,
  checkinWeeks: Set<number>,
): number {
  if (currentWeek < 1) return 0;
  let unlocked = 1;
  while (
    unlocked < Math.min(currentWeek, PROGRAM_WEEKS) &&
    checkinWeeks.has(unlocked)
  ) {
    unlocked += 1;
  }
  return unlocked;
}

export function computeStreak(
  days: Pick<MentorshipPlanDay, "dayIndex" | "completedAt">[],
  todayIndex: number,
): number {
  if (todayIndex < 1) return 0;
  const closed = new Set(
    days.filter((d) => d.completedAt).map((d) => d.dayIndex),
  );
  // A streak survives until today's day is missed; today itself is optional
  // (the day may not be over yet).
  const start = closed.has(todayIndex) ? todayIndex : todayIndex - 1;
  let streak = 0;
  for (let i = start; i >= 1; i--) {
    if (closed.has(i)) streak += 1;
    else break;
  }
  return streak;
}

export async function getPlanState(menteeId: string): Promise<PlanState> {
  const [days, checkins] = await Promise.all([
    prisma.mentorshipPlanDay.findMany({
      where: { menteeId },
      orderBy: { dayIndex: "asc" },
      include: { tasks: { orderBy: { order: "asc" } } },
    }),
    prisma.mentorshipCheckin.findMany({
      where: { menteeId },
      select: { week: true },
    }),
  ]);

  const todayIndex = planDayIndex();
  const currentWeek = Math.min(
    Math.max(1, weekOfPlanDay(Math.max(1, todayIndex))),
    PROGRAM_WEEKS,
  );
  const checkinWeeks = new Set(checkins.map((c) => c.week));
  const unlockedWeek =
    todayIndex < 1 ? 0 : computeUnlockedWeek(currentWeek, checkinWeeks);
  const visibleWeek = Math.min(unlockedWeek + 1, PROGRAM_WEEKS);

  const allTasks = days.flatMap((d) => d.tasks);
  const doneTasks = allTasks.filter((t) => t.status === "done");

  return {
    days,
    hasPlan: days.length > 0,
    todayIndex,
    currentWeek,
    unlockedWeek,
    visibleWeek,
    streak: computeStreak(days, todayIndex),
    pointsEarned: doneTasks.reduce((sum, t) => sum + t.points, 0),
    pointsTotal: allTasks.reduce((sum, t) => sum + t.points, 0),
    tasksDone: doneTasks.length,
    tasksTotal: allTasks.length,
  };
}

// True when the mentee may work on this day: its week is unlocked and, for
// closing out (check-in), the calendar has reached it. Working ahead within
// an unlocked week is allowed; closing out a future day is not.
export function canWorkDay(day: MentorshipPlanDay, unlockedWeek: number): boolean {
  return day.week <= unlockedWeek;
}

export function canCloseDay(
  day: MentorshipPlanDay,
  unlockedWeek: number,
): boolean {
  return day.week <= unlockedWeek && day.date.getTime() <= lagosDate().getTime();
}
