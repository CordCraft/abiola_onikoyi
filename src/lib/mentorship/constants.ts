// ---------------------------------------------------------------------------
// Mentorship programme configuration and shared vocabulary.
// Safe to import from client and server components (no server-only deps).
// ---------------------------------------------------------------------------

// Cohort 1 kicked off with the inaugural Google Meet on Sat 25 July 2026;
// the structured daily programme (week 1, day 1) starts Saturday 1 August.
// Weeks run Saturday to Friday so the heavier work lands on weekends.
export const PROGRAM_START_ISO = "2026-08-01T00:00:00.000Z";
export const PROGRAM_WEEKS = 13; // three months
export const PROGRAM_DAYS = PROGRAM_WEEKS * 7; // 91 daily plan days
export const COHORT_LABEL = "Cohort 1 · 2026";
export const DEFAULT_COHORT_ID = "2026-C1";

// Cohort lifecycle. "upcoming" before its programme starts, "active" while it
// runs, "closed" once the mentor wraps it up (mentees lose portal access and
// their open check-ins stop asking for a reply).
export const COHORT_STATUSES = ["upcoming", "active", "closed"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

// Days from today until a date (Lagos calendar days), negative once passed.
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.round(
    (lagosDate(date).getTime() - lagosDate(now).getTime()) / 86_400_000,
  );
}

// The programme end (last plan day) for a cohort start.
export function programEndDate(startIso: string = PROGRAM_START_ISO): Date {
  return dateOfPlanDay(PROGRAM_DAYS, startIso);
}

export const MONTH_THEMES: Record<number, { title: string; blurb: string }> = {
  1: {
    title: "Discovery and direction",
    blurb:
      "Self-assessment, an Individual Development Plan, and three concrete goals agreed one on one.",
  },
  2: {
    title: "Build and exposure",
    blurb:
      "Execute tasks tied to your goals: CV and LinkedIn overhaul, informational interviews, a technical mini-project or certification start.",
  },
  3: {
    title: "Deliver and launch",
    blurb:
      "Produce one capstone artifact and leave with a written roadmap for your next 12 months.",
  },
};

// Cadence per mentee: daily programme tasks plus the human touchpoints.
export const CADENCE = [
  { label: "Daily micro-tasks in your personalised programme", perMonth: 30 },
  { label: "Weekly check-ins that unlock your next week", perMonth: 4 },
  { label: "One-on-one review with your mentor", perMonth: 1 },
  { label: "Group session with the cohort", perMonth: 1 },
];

export const GOAL_STATUSES = ["active", "completed", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TASK_STATUSES = ["todo", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SESSION_KINDS = ["group", "one_on_one"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["upcoming", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const RESOURCE_CATEGORIES = [
  "reading",
  "video",
  "course",
  "tool",
  "other",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  reading: "Reading",
  video: "Video",
  course: "Course",
  tool: "Tool",
  other: "Other",
};

// Profile vocabulary used by onboarding and the profile page.
export const INTEREST_OPTIONS = [
  "Process Safety",
  "Reservoir Engineering",
  "Production Operations",
  "Clean Energy & Transition",
  "Data & Digital",
  "Project Management",
  "Research & Academia",
  "Entrepreneurship",
  "Commercial & Trading",
  "HSE & Sustainability",
] as const;

export const LEVEL_OPTIONS = [
  "100 Level",
  "200 Level",
  "300 Level",
  "400 Level",
  "500 Level",
  "Recent graduate",
] as const;

export const COMMS_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Portal messages" },
  { value: "call", label: "Phone call" },
] as const;

// Programme week for a given date: 0 before kickoff, 1..PROGRAM_WEEKS during,
// PROGRAM_WEEKS + 1 once the cohort has wrapped.
// Every date helper takes the cohort's programme start (day 1, a Saturday) as
// an ISO string; it defaults to Cohort 1 so older call sites keep working.
// Resolve a mentee's start with cohortStartIso() in src/lib/mentorship/cohorts.ts.
export function programWeek(
  now: Date = new Date(),
  startIso: string = PROGRAM_START_ISO,
): number {
  const start = new Date(startIso).getTime();
  const diff = now.getTime() - start;
  if (diff < 0) return 0;
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return week > PROGRAM_WEEKS ? PROGRAM_WEEKS + 1 : week;
}

// Programme month (1..3) a given week falls in.
export function monthOfWeek(week: number): number {
  if (week <= 4) return 1;
  if (week <= 8) return 2;
  return 3;
}

export function programProgressPct(
  now: Date = new Date(),
  startIso: string = PROGRAM_START_ISO,
): number {
  const week = programWeek(now, startIso);
  if (week === 0) return 0;
  if (week > PROGRAM_WEEKS) return 100;
  return Math.round(((week - 1) / PROGRAM_WEEKS) * 100);
}

// ---------------------------------------------------------------------------
// Daily plan vocabulary and date arithmetic. Day boundaries follow Lagos time
// (UTC+1, no DST) so "today's tasks" flip over at midnight for the mentees.
// ---------------------------------------------------------------------------

export const PLAN_TASK_KINDS = [
  "mindset",
  "skill",
  "project",
  "career",
  "checkpoint",
] as const;
export type PlanTaskKind = (typeof PLAN_TASK_KINDS)[number];

export const PLAN_KIND_LABELS: Record<PlanTaskKind, string> = {
  mindset: "Mindset",
  skill: "Skill",
  project: "Project",
  career: "Career",
  checkpoint: "Checkpoint",
};

// The calendar date in Lagos for a given instant, at UTC midnight. Plan day
// dates are stored the same way, so equality comparisons are exact.
export function lagosDate(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + 60 * 60 * 1000); // UTC+1
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

// 1-based plan day index for a date; 0 before the programme, PROGRAM_DAYS + 1
// once it has wrapped.
export function planDayIndex(
  now: Date = new Date(),
  startIso: string = PROGRAM_START_ISO,
): number {
  const start = new Date(startIso).getTime();
  const diff = lagosDate(now).getTime() - start;
  if (diff < 0) return 0;
  const day = Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
  return day > PROGRAM_DAYS ? PROGRAM_DAYS + 1 : day;
}

export function dateOfPlanDay(
  dayIndex: number,
  startIso: string = PROGRAM_START_ISO,
): Date {
  const start = new Date(startIso).getTime();
  return new Date(start + (dayIndex - 1) * 24 * 60 * 60 * 1000);
}

export function weekOfPlanDay(dayIndex: number): number {
  return Math.ceil(dayIndex / 7);
}
