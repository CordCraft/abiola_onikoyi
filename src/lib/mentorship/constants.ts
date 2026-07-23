// ---------------------------------------------------------------------------
// Mentorship programme configuration and shared vocabulary.
// Safe to import from client and server components (no server-only deps).
// ---------------------------------------------------------------------------

// Cohort 1 kicked off on Saturday 25 July 2026 with the inaugural Google Meet.
export const PROGRAM_START_ISO = "2026-07-25T00:00:00.000Z";
export const PROGRAM_WEEKS = 13; // three months
export const COHORT_LABEL = "Cohort 1 · 2026";

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

// Monthly cadence per mentee: 1 one-on-one, 1 group session, 2 async check-ins.
export const CADENCE = [
  { label: "One-on-one with your mentor", perMonth: 1 },
  { label: "Group session with the cohort", perMonth: 1 },
  { label: "Async portal check-ins", perMonth: 2 },
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

// Programme week for a given date: 0 before kickoff, 1..PROGRAM_WEEKS during,
// PROGRAM_WEEKS + 1 once the cohort has wrapped.
export function programWeek(now: Date = new Date()): number {
  const start = new Date(PROGRAM_START_ISO).getTime();
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

export function programProgressPct(now: Date = new Date()): number {
  const week = programWeek(now);
  if (week === 0) return 0;
  if (week > PROGRAM_WEEKS) return 100;
  return Math.round(((week - 1) / PROGRAM_WEEKS) * 100);
}
