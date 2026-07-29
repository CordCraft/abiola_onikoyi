import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { MentorshipMentee } from "@prisma/client";
import { profileSummary } from "@/lib/mentorship/goal-draft";
import {
  MINDSET,
  WEEK_TAGLINES,
  POINTS,
  CHECKIN_TASK,
} from "@/lib/mentorship/mindset";
import {
  PROGRAM_WEEKS,
  dateOfPlanDay,
  PLAN_TASK_KINDS,
} from "@/lib/mentorship/constants";

// Automatic programme generation for mentees who sign up after the cohort's
// hand-authored plans were seeded. Two stages, both on the plain-JSON pattern
// of goal-draft.ts, both with template fallbacks so nothing ever blocks:
//
// 1. Blueprint (once, right after signup): a track name, a capstone project
//    designed from the mentee's own goals, and 13 week themes.
// 2. Week generation (lazy, one Claude call per week): the 7 days of core
//    tasks for a week, generated when the mentee first needs that week and
//    steered by the blueprint, their goals, and their latest check-in. The
//    shared daily mindset arc and Friday check-in task are layered on top in
//    code, identical for every mentee.
//
// The curriculum rules mirror the hand-authored cohort plans: weekends carry
// the heavy blocks, weekdays are 25-40 minute reps, Friday is a from-memory
// checkpoint with evidence, month 1 = foundations, month 2 = build and ship
// the capstone, month 3 = applications and launch.

const MODEL = "claude-opus-4-8";

export type Blueprint = {
  track: string;
  capstoneTitle: string;
  capstoneSummary: string;
  weeks: { week: number; theme: string; focus: string }[];
};

// ---------------------------------------------------------------------------
// Stage 1: blueprint
// ---------------------------------------------------------------------------

function fallbackBlueprint(mentee: MentorshipMentee): Blueprint {
  const interest = mentee.interests?.split(",")[0]?.trim() || "your focus area";
  const themes = [
    "Foundation and focus",
    "The consistency engine",
    "Working with real information",
    "First tools, first proof",
    "Capstone spec",
    "Build the core",
    "Make it usable",
    "Polish and publish",
    "Tell the story",
    "Your story on paper",
    "Applications live",
    "Interview-ready",
    "Launch and legacy",
  ];
  return {
    track: `The Growth Path · ${interest}`,
    capstoneTitle: `A portfolio project in ${interest}`,
    capstoneSummary: `One real, finished artifact in ${interest} that proves ability: scoped in week 5, built in weeks 6 to 8, published with documentation in week 9, and used as evidence in month 3 applications.`,
    weeks: themes.map((theme, i) => ({
      week: i + 1,
      theme,
      focus:
        i < 4
          ? `Build daily fundamentals for ${interest} and lock in direction.`
          : i < 9
            ? "Design, build, and ship the capstone project step by step."
            : "Turn the work into a CV, public profile, applications, and interviews.",
    })),
  };
}

function parseJsonBlock(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function blueprintWithClaude(
  mentee: MentorshipMentee,
): Promise<Blueprint> {
  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 2500,
      system: [
        "You design personalised 13-week (91-day) mentorship programmes for Nigerian chemical engineering students, on behalf of their mentor, a senior petroleum engineer (17+ years, Shell and Saudi Aramco).",
        "Programme shape: month 1 (weeks 1-4) foundations and direction; month 2 (weeks 5-9) design, build, and publicly ship ONE capstone project chosen from the mentee's own goals; month 3 (weeks 10-13) CV, LinkedIn, personal statement, applications, interviews, and a final showcase.",
        "The capstone must be concrete, achievable by a beginner in 5 weeks of part-time work, produce a public artifact (GitHub repo, published analysis, deployed tool), and bridge the mentee's engineering background with their stated ambitions.",
        "Pick ONE primary direction when the mentee lists many interests; depth beats breadth.",
        "Do not use em dashes anywhere.",
        "Respond with ONLY JSON: {\"track\": string (short label like 'The Builder's Path · ChemE x AI'), \"capstoneTitle\": string, \"capstoneSummary\": string (2-3 sentences), \"weeks\": [{\"week\": 1..13, \"theme\": string (2-4 words), \"focus\": string (1-2 sentences on what that week accomplishes)}] with exactly 13 entries}.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: `Design the programme blueprint for this mentee:\n\n${profileSummary(mentee)}`,
        },
      ],
    },
    { timeout: 45_000 },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJsonBlock(text) as Partial<Blueprint>;

  const weeks = Array.isArray(parsed.weeks)
    ? parsed.weeks
        .map((w, i) => ({
          week: Number(w?.week) >= 1 && Number(w?.week) <= 13 ? Number(w.week) : i + 1,
          theme: String(w?.theme ?? "").slice(0, 60),
          focus: String(w?.focus ?? "").slice(0, 400),
        }))
        .filter((w) => w.theme)
    : [];
  if (weeks.length !== PROGRAM_WEEKS) throw new Error("Blueprint weeks invalid");

  const blueprint: Blueprint = {
    track: String(parsed.track ?? "").slice(0, 80) || "The Growth Path",
    capstoneTitle: String(parsed.capstoneTitle ?? "").slice(0, 120),
    capstoneSummary: String(parsed.capstoneSummary ?? "").slice(0, 600),
    weeks,
  };
  if (!blueprint.capstoneTitle) throw new Error("Blueprint missing capstone");
  return blueprint;
}

// Generates and stores the blueprint if the mentee does not have one.
// Never throws; returns the blueprint (generated, stored, or fallback).
export async function ensureBlueprint(menteeId: string): Promise<Blueprint | null> {
  try {
    const mentee = await prisma.mentorshipMentee.findUnique({
      where: { id: menteeId },
    });
    if (!mentee) return null;

    if (mentee.programBlueprint) {
      try {
        return JSON.parse(mentee.programBlueprint) as Blueprint;
      } catch {
        // Corrupt blueprint: regenerate below.
      }
    }

    let blueprint: Blueprint;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        blueprint = await blueprintWithClaude(mentee);
      } catch {
        blueprint = fallbackBlueprint(mentee);
      }
    } else {
      blueprint = fallbackBlueprint(mentee);
    }

    await prisma.mentorshipMentee.update({
      where: { id: mentee.id },
      data: {
        track: blueprint.track,
        programBlueprint: JSON.stringify(blueprint),
      },
    });
    return blueprint;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 2: one week of days
// ---------------------------------------------------------------------------

type GenTask = {
  kind: string;
  minutes: number;
  title: string;
  detail: string;
  evidenceHint: string | null;
};

type GenDay = { title: string; tasks: GenTask[] };

function clampTask(raw: unknown): GenTask | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const kind = (PLAN_TASK_KINDS as readonly string[]).includes(String(t.kind))
    ? String(t.kind)
    : "skill";
  const title = String(t.title ?? "").slice(0, 150);
  if (!title) return null;
  const minutes = Math.min(120, Math.max(10, Number(t.minutes) || 30));
  return {
    kind: kind === "mindset" ? "skill" : kind, // mindset comes from the shared arc
    minutes,
    title,
    detail: String(t.detail ?? "").slice(0, 900),
    evidenceHint: t.evidenceHint ? String(t.evidenceHint).slice(0, 300) : null,
  };
}

function fallbackWeek(
  mentee: MentorshipMentee,
  blueprint: Blueprint | null,
  week: number,
  goals: { title: string; targetMonth: number | null }[],
): GenDay[] {
  const month = week <= 4 ? 1 : week <= 9 ? 2 : 3;
  const goal =
    goals.find((g) => g.targetMonth === month)?.title ??
    goals[0]?.title ??
    "your main goal";
  const theme = blueprint?.weeks?.[week - 1]?.theme ?? `Week ${week}`;
  const focus =
    blueprint?.weeks?.[week - 1]?.focus ??
    `Steady progress on ${goal.toLowerCase()}.`;

  const core = (mins: number): GenTask => ({
    kind: month === 2 ? "project" : month === 3 ? "career" : "skill",
    minutes: mins,
    title: `Focused block: ${goal}`,
    detail: `${focus} Work ${mins} distraction-free minutes on the next concrete step, then write down what you finished and what comes next. If you are unsure of the step, message your mentor in the portal.`,
    evidenceHint: null,
  });

  return [
    { title: `${theme}: deep work`, tasks: [core(75)] },
    { title: `${theme}: continue`, tasks: [core(50)] },
    { title: "Daily rep", tasks: [core(30)] },
    { title: "Daily rep", tasks: [core(30)] },
    { title: "Daily rep", tasks: [core(30)] },
    { title: "Push it further", tasks: [core(40)] },
    {
      title: "Weekly checkpoint",
      tasks: [
        {
          kind: "checkpoint",
          minutes: 30,
          title: `Week ${week} checkpoint: show your work`,
          detail:
            "Write a short summary of what you produced this week, what you learned, and what blocked you. Be specific; this is the evidence your mentor reviews.",
          evidenceHint:
            "Paste links or a summary of what you produced this week.",
        },
      ],
    },
  ];
}

async function weekWithClaude(
  mentee: MentorshipMentee,
  blueprint: Blueprint,
  week: number,
  goals: { title: string; detail: string | null; targetMonth: number | null }[],
  lastCheckin: { wins: string; blockers: string | null; nextFocus: string | null } | null,
): Promise<GenDay[]> {
  const client = new Anthropic();
  const month = week <= 4 ? 1 : week <= 9 ? 2 : 3;
  const wk = blueprint.weeks[week - 1];

  const context = [
    `MENTEE PROFILE:\n${profileSummary(mentee)}`,
    `TRACK: ${blueprint.track}`,
    `CAPSTONE PROJECT: ${blueprint.capstoneTitle}. ${blueprint.capstoneSummary}`,
    `PROGRAMME MONTH: ${month} of 3`,
    `THIS WEEK (${week} of 13): ${wk?.theme ?? ""}. ${wk?.focus ?? ""}`,
    week > 1 && blueprint.weeks[week - 2]
      ? `LAST WEEK WAS: ${blueprint.weeks[week - 2].theme}. ${blueprint.weeks[week - 2].focus}`
      : null,
    week < 13 && blueprint.weeks[week]
      ? `NEXT WEEK WILL BE: ${blueprint.weeks[week].theme}`
      : null,
    goals.length
      ? `PROGRAMME GOALS:\n${goals
          .map((g) => `- (month ${g.targetMonth ?? "?"}) ${g.title}`)
          .join("\n")}`
      : null,
    lastCheckin
      ? `LATEST WEEKLY CHECK-IN FROM THE MENTEE:\nWins: ${lastCheckin.wins}\nBlockers: ${lastCheckin.blockers ?? "none given"}\nWants to focus on: ${lastCheckin.nextFocus ?? "not given"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 4000,
      system: [
        "You write one week (7 days, Saturday through Friday) of daily micro-tasks for a personalised mentorship programme. The mentor is a senior petroleum engineer; mentees are Nigerian chemical engineering students.",
        "Rhythm rules: Saturday is the heavy block (60-90 min main task), Sunday medium (45-60), Monday to Thursday are short reps (25-40 min) that a busy student can honestly finish, Friday holds a 25-40 min from-memory checkpoint self-test that proves the week stuck (closed book, build or write from scratch, compare) and MUST have an evidenceHint.",
        "Each day: 1-2 core tasks (never 3). Kinds: 'skill' (learning reps), 'project' (capstone work), 'career' (CV, applications, outreach, review prep), 'checkpoint' (Friday tests and month-end self-assessments). A separate daily mindset exercise is added by the system, so do not write mindset tasks.",
        "Tasks must be concrete and specific to THIS mentee: name the actual scripts, datasets, documents, or messages they produce. Details are 1-3 sentences, direct, warm, second person. Give evidenceHint (what to paste: links, output, answers) on Friday checkpoints and on ship/publish tasks, at most 3 per week.",
        "Respect their story: reference their goals, struggles, and ambitions where it lands naturally. Address their stated challenges (procrastination, confidence, consistency) through task design: small reps, clear definitions of done.",
        "If the latest check-in mentions blockers, adapt: shrink task sizes, add a catch-up day, or address the blocker directly.",
        "Do not use em dashes anywhere.",
        "Respond with ONLY JSON: an array of exactly 7 objects {\"title\": string (2-4 word day title), \"tasks\": [{\"kind\": \"skill\"|\"project\"|\"career\"|\"checkpoint\", \"minutes\": number, \"title\": string, \"detail\": string, \"evidenceHint\": string or null}]}. Saturday is index 0, Friday index 6.",
      ].join(" "),
      messages: [{ role: "user", content: `Write week ${week}:\n\n${context}` }],
    },
    { timeout: 90_000 },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJsonBlock(text);
  if (!Array.isArray(parsed) || parsed.length !== 7) {
    throw new Error("Expected exactly 7 days");
  }

  const days = parsed.map((d, i) => {
    const day = d as Record<string, unknown>;
    const tasks = (Array.isArray(day.tasks) ? day.tasks : [])
      .map(clampTask)
      .filter((t): t is GenTask => t !== null)
      .slice(0, 2);
    if (tasks.length === 0) throw new Error(`Day ${i + 1} has no tasks`);
    return {
      title: String(day.title ?? "").slice(0, 60) || `Day ${i + 1}`,
      tasks,
    };
  });

  // The Friday checkpoint is the week's test; guarantee it exists.
  if (!days[6].tasks.some((t) => t.kind === "checkpoint")) {
    days[6].tasks = [
      {
        kind: "checkpoint",
        minutes: 30,
        title: `Week ${week} checkpoint: show your work`,
        detail:
          "Closed book: reproduce the core of what you practised this week from memory, then compare with your notes. Summarise what stuck and what needs another rep.",
        evidenceHint: "Paste your from-memory attempt and one line on the gaps.",
      },
      ...days[6].tasks.slice(0, 1),
    ];
  }
  return days;
}

// Ensures the plan days for one week exist, generating them if needed.
// Returns "exists" | "created" | "failed". Safe under concurrent calls: the
// (menteeId, dayIndex) unique constraint makes the second writer lose, which
// is treated as success.
export async function ensureWeekGenerated(
  menteeId: string,
  week: number,
): Promise<"exists" | "created" | "failed"> {
  if (week < 1 || week > PROGRAM_WEEKS) return "failed";

  const existing = await prisma.mentorshipPlanDay.count({
    where: { menteeId, week },
  });
  if (existing > 0) return "exists";

  const mentee = await prisma.mentorshipMentee.findUnique({
    where: { id: menteeId },
  });
  if (!mentee) return "failed";

  const blueprint = await ensureBlueprint(menteeId);

  const [goals, lastCheckin] = await Promise.all([
    prisma.mentorshipGoal.findMany({
      where: { menteeId, status: "active" },
      select: { title: true, detail: true, targetMonth: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mentorshipCheckin.findFirst({
      where: { menteeId },
      orderBy: { week: "desc" },
      select: { wins: true, blockers: true, nextFocus: true },
    }),
  ]);

  let days: GenDay[];
  if (process.env.ANTHROPIC_API_KEY && blueprint) {
    try {
      days = await weekWithClaude(mentee, blueprint, week, goals, lastCheckin);
    } catch {
      days = fallbackWeek(mentee, blueprint, week, goals);
    }
  } else {
    days = fallbackWeek(mentee, blueprint, week, goals);
  }

  try {
    for (let d = 0; d < 7; d++) {
      const dayIndex = (week - 1) * 7 + d + 1;
      const mindset = MINDSET[week - 1][d];
      const tuples = [
        {
          kind: "mindset",
          minutes: 8,
          points: POINTS.mindset,
          title: `Mindset: ${mindset.t}`,
          detail: mindset.d,
          evidenceHint: null as string | null,
        },
        ...days[d].tasks.map((t) => ({
          kind: t.kind,
          minutes: t.minutes,
          points: POINTS[t.kind as keyof typeof POINTS] ?? 10,
          title: t.title,
          detail: t.detail,
          evidenceHint: t.evidenceHint,
        })),
        ...(d === 6
          ? [
              {
                kind: CHECKIN_TASK.kind as string,
                minutes: CHECKIN_TASK.minutes,
                points: CHECKIN_TASK.points,
                title: CHECKIN_TASK.title,
                detail: CHECKIN_TASK.detail,
                evidenceHint: null as string | null,
              },
            ]
          : []),
      ];

      await prisma.mentorshipPlanDay.create({
        data: {
          menteeId,
          dayIndex,
          date: dateOfPlanDay(dayIndex),
          week,
          title: days[d].title,
          mindset: WEEK_TAGLINES[week - 1],
          tasks: {
            create: tuples.map((t, order) => ({ ...t, order, menteeId })),
          },
        },
      });
    }
    return "created";
  } catch {
    // Most likely a concurrent generation won the race on the unique
    // constraint; if days exist now, that is success.
    const now = await prisma.mentorshipPlanDay.count({
      where: { menteeId, week },
    });
    return now > 0 ? "exists" : "failed";
  }
}
