import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { MentorshipCohort } from "@prisma/client";
import {
  COHORT_LABEL,
  DEFAULT_COHORT_ID,
  PROGRAM_DAYS,
  PROGRAM_START_ISO,
  PROGRAM_WEEKS,
  daysUntil,
  planDayIndex,
  programEndDate,
  programProgressPct,
  programWeek,
} from "@/lib/mentorship/constants";

// Cohorts give each intake its own calendar. Everything date-based (week,
// plan day, progress, check-in windows) is computed from the mentee's cohort
// start, never from a global constant. Rows live in MentorshipCohort; a
// mentee's `cohort` column holds the id.

export type CohortClock = {
  id: string;
  label: string;
  status: string;
  startIso: string;
  kickoffAt: Date | null;
  startDate: Date;
  endDate: Date;
  week: number; // 0 before start, 1..13 during, 14 after
  dayIndex: number; // 0 before start, 1..91 during, 92 after
  inProgram: boolean;
  progressPct: number;
  daysToStart: number; // negative once started
  daysToKickoff: number | null;
  closed: boolean;
};

const FALLBACK: MentorshipCohort = {
  id: DEFAULT_COHORT_ID,
  label: COHORT_LABEL,
  kickoffAt: new Date("2026-07-25T09:00:00.000Z"),
  startDate: new Date(PROGRAM_START_ISO),
  status: "active",
  closedAt: null,
  createdAt: new Date(PROGRAM_START_ISO),
  updatedAt: new Date(PROGRAM_START_ISO),
};

export function clockFor(
  cohort: MentorshipCohort,
  now: Date = new Date(),
): CohortClock {
  const startIso = cohort.startDate.toISOString();
  const week = programWeek(now, startIso);
  const dayIndex = planDayIndex(now, startIso);
  return {
    id: cohort.id,
    label: cohort.label,
    status: cohort.status,
    startIso,
    kickoffAt: cohort.kickoffAt,
    startDate: cohort.startDate,
    endDate: programEndDate(startIso),
    week,
    dayIndex,
    inProgram: week >= 1 && week <= PROGRAM_WEEKS && dayIndex <= PROGRAM_DAYS,
    progressPct: programProgressPct(now, startIso),
    daysToStart: daysUntil(cohort.startDate, now),
    daysToKickoff: cohort.kickoffAt ? daysUntil(cohort.kickoffAt, now) : null,
    closed: cohort.status === "closed",
  };
}

// Newest first. Cached per request.
export const listCohorts = cache(async (): Promise<MentorshipCohort[]> => {
  try {
    const rows = await prisma.mentorshipCohort.findMany({
      orderBy: { startDate: "desc" },
    });
    return rows.length > 0 ? rows : [FALLBACK];
  } catch {
    return [FALLBACK];
  }
});

export async function getCohort(id: string | null | undefined): Promise<MentorshipCohort> {
  const all = await listCohorts();
  return all.find((c) => c.id === id) ?? all.find((c) => c.id === DEFAULT_COHORT_ID) ?? FALLBACK;
}

export async function cohortClockFor(
  id: string | null | undefined,
  now: Date = new Date(),
): Promise<CohortClock> {
  return clockFor(await getCohort(id), now);
}

// The cohort new sign-ups join: the soonest cohort that is not closed and has
// not started yet, else the most recent open one.
export async function currentIntakeCohort(): Promise<MentorshipCohort> {
  const all = await listCohorts();
  const open = all.filter((c) => c.status !== "closed");
  const upcoming = open
    .filter((c) => daysUntil(c.startDate) >= 0)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return upcoming[0] ?? open[0] ?? all[0] ?? FALLBACK;
}

// Status the calendar implies (closed stays closed: only the mentor closes).
export function derivedStatus(cohort: MentorshipCohort, now: Date = new Date()): string {
  if (cohort.status === "closed") return "closed";
  return daysUntil(cohort.startDate, now) > 0 ? "upcoming" : "active";
}
