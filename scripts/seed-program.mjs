// Seeds the 91-day mentorship programme into the database for both mentees:
// dated plan days with tasks (mindset + core + Friday check-in reminder),
// AI toolkit rows, monthly one-on-one review sessions, the cohort showcase,
// the kickoff announcement, and starter resources.
//
// Run from the repo root (DATABASE_URL comes from .env):
//   node scripts/seed-program.mjs           # refuses to overwrite progress
//   node scripts/seed-program.mjs --force   # wipes and re-seeds plans anyway
//
// Idempotent: re-running replaces each mentee's plan (unless progress exists
// and --force is missing) and skips sessions/announcement/resources that
// already exist by title.

import { PrismaClient } from "@prisma/client";
import { MINDSET, WEEK_TAGLINES, expandTask, CHECKIN_TASK } from "./mentorship-program/shared.mjs";
import { ARAFAT } from "./mentorship-program/arafat.mjs";
import { UTAZI } from "./mentorship-program/utazi.mjs";

const prisma = new PrismaClient();
const FORCE = process.argv.includes("--force");

// Saturday 1 August 2026, UTC midnight (Lagos day boundaries are handled in
// app code; stored dates are the calendar date at UTC midnight).
const START = Date.UTC(2026, 7, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOfDay(dayIndex) {
  return new Date(START + (dayIndex - 1) * DAY_MS);
}

// WAT (UTC+1) wall-clock to UTC instant.
function wat(y, m, d, hh, mm = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
}

async function seedPlan(curriculum) {
  const mentee = await prisma.mentorshipMentee.findUnique({
    where: { email: curriculum.email },
  });
  if (!mentee) {
    console.error(`SKIP: no mentee with email ${curriculum.email}`);
    return null;
  }

  const progress = await prisma.mentorshipPlanTask.count({
    where: { menteeId: mentee.id, status: "done" },
  });
  if (progress > 0 && !FORCE) {
    console.error(
      `SKIP ${mentee.name}: ${progress} completed plan tasks exist. Re-run with --force to wipe and re-seed.`,
    );
    return null;
  }

  await prisma.mentorshipPlanDay.deleteMany({ where: { menteeId: mentee.id } });

  let dayCount = 0;
  let taskCount = 0;
  for (let w = 0; w < curriculum.weeks.length; w++) {
    const week = curriculum.weeks[w];
    if (week.days.length !== 7) {
      throw new Error(`${curriculum.email} week ${w + 1} has ${week.days.length} days (needs 7)`);
    }
    for (let d = 0; d < 7; d++) {
      const day = week.days[d];
      const dayIndex = w * 7 + d + 1;
      const mindset = MINDSET[w][d];

      const tuples = [
        ["mindset", 8, `Mindset: ${mindset.t}`, mindset.d],
        ...day.tasks,
        // Friday carries the weekly check-in that unlocks the next week.
        ...(d === 6 ? [CHECKIN_TASK] : []),
      ];

      await prisma.mentorshipPlanDay.create({
        data: {
          menteeId: mentee.id,
          dayIndex,
          date: dateOfDay(dayIndex),
          week: w + 1,
          title: day.t,
          mindset: WEEK_TAGLINES[w],
          tasks: {
            create: tuples.map((tuple, order) => ({
              ...expandTask(tuple, order),
              menteeId: mentee.id,
            })),
          },
        },
      });
      dayCount += 1;
      taskCount += tuples.length;
    }
  }

  // AI toolkit rows: every tool starts "available" so the mentee can request.
  for (const tool of ["anthropic", "openai", "fal"]) {
    await prisma.mentorshipAiTool.upsert({
      where: { menteeId_tool: { menteeId: mentee.id, tool } },
      create: { menteeId: mentee.id, tool },
      update: {},
    });
  }

  console.log(`Seeded ${mentee.name}: ${dayCount} days, ${taskCount} tasks (${curriculum.track})`);
  return mentee;
}

async function seedSession(data) {
  const existing = await prisma.mentorshipSession.findFirst({
    where: { title: data.title, menteeId: data.menteeId ?? null },
    select: { id: true },
  });
  if (existing) return;
  await prisma.mentorshipSession.create({ data });
  console.log(`Session: ${data.title}${data.menteeId ? " (1:1)" : " (group)"}`);
}

async function seedResource(data) {
  const existing = await prisma.mentorshipResource.findFirst({
    where: { title: data.title },
    select: { id: true },
  });
  if (existing) return;
  await prisma.mentorshipResource.create({ data });
}

async function main() {
  const arafat = await seedPlan(ARAFAT);
  const utazi = await seedPlan(UTAZI);

  // Monthly one-on-one reviews (Saturdays fit both mentees' availability;
  // Utazi listed Sat 5-8pm, Arafat weekends from 12pm).
  const reviews = [
    { n: 1, y: 2026, m: 8, d: 29 },
    { n: 2, y: 2026, m: 9, d: 26 },
    { n: 3, y: 2026, m: 10, d: 24 },
  ];
  for (const r of reviews) {
    if (utazi) {
      await seedSession({
        title: `Month ${r.n} review with your mentor`,
        kind: "one_on_one",
        menteeId: utazi.id,
        scheduledAt: wat(r.y, r.m, r.d, 17, 0),
        agenda:
          "Bring your five prepared bullets: wins, struggles, the numbers (streak, points, error trend), and what you need from the next month. We review your checkpoint evidence together and adjust the plan.",
      });
    }
    if (arafat) {
      await seedSession({
        title: `Month ${r.n} review with your mentor`,
        kind: "one_on_one",
        menteeId: arafat.id,
        scheduledAt: wat(r.y, r.m, r.d, 18, 15),
        agenda:
          "Bring your five prepared bullets: wins, struggles, the numbers (streak, points, submissions), and what you need from the next month. We review your checkpoint evidence together and adjust the plan.",
      });
    }
  }

  await seedSession({
    title: "Cohort showcase and graduation",
    kind: "group",
    scheduledAt: wat(2026, 10, 31, 17, 0),
    agenda:
      "Each mentee presents their five-minute journey talk with a live demo of their project. Family of the programme, bring your energy. We close with next-12-months commitments.",
  });

  // Kickoff announcement explaining how the daily engine works.
  const annTitle = "Your 91-day journey starts Saturday 1 August";
  const annExists = await prisma.mentorshipAnnouncement.findFirst({
    where: { title: annTitle },
    select: { id: true },
  });
  if (!annExists) {
    await prisma.mentorshipAnnouncement.create({
      data: {
        title: annTitle,
        body: [
          "From Saturday, your portal has a new Daily Programme tab. Here is how it works:",
          "",
          "1. Every day has micro-tasks: a short mindset exercise plus skill, project, or career work, sized to fit around your schedule. Weekends carry the bigger builds.",
          "2. Complete tasks to earn points and keep your streak alive. Some tasks ask for evidence: a link, an output, an answer. I read what you submit and leave comments.",
          "3. Close each day with a one-line reflection and a confidence rating. That is your daily check-in.",
          "4. Fridays are checkpoint days: a self-test that shows both of us what stuck. Submit your weekly check-in on Friday to unlock the next week. You can always see one week ahead.",
          "5. The AI Toolkit tab is where you request API keys (Claude, OpenAI, fal.ai) for your project work. Ask when your plan calls for them and tell me what you are building.",
          "6. We meet one-on-one at the end of every month to review your evidence and adjust the plan. The dates are already in your Sessions tab.",
          "",
          "The programme is personal: your tasks were built from your own story, goals, and challenges. Show up daily, even for twenty minutes. Consistency is the entire trick.",
        ].join("\n"),
      },
    });
    console.log("Announcement created.");
  }

  // Starter resources referenced by the curricula.
  const resources = [
    { title: "Python for Everybody (free course)", url: "https://www.py4e.com/", category: "course", pinned: true, note: "The gentlest serious Python course. Chapters 1-9 cover everything month 1 asks of you." },
    { title: "Automate the Boring Stuff with Python (free book)", url: "https://automatetheboringstuff.com/", category: "reading", pinned: true, note: "Read the chapters that match your week: files, CSV, and web APIs." },
    { title: "Kaggle Learn: Pandas", url: "https://www.kaggle.com/learn/pandas", category: "course", note: "Short interactive pandas lessons. Perfect companion for the data project weeks." },
    { title: "Streamlit documentation", url: "https://docs.streamlit.io/", category: "tool", note: "For turning your scripts into web apps in month 2." },
    { title: "Claude API quickstart", url: "https://docs.anthropic.com/en/docs/get-started", category: "tool", note: "Pairs with the AI Toolkit tab once your key is granted." },
    { title: "US CSB incident investigations", url: "https://www.csb.gov/investigations/", category: "reading", note: "Real process-safety incident reports. Source material for SafeOps AI." },
    { title: "World Bank Open Data", url: "https://data.worldbank.org/country/nigeria", category: "tool", note: "Nigeria indicators for the Energy Pulse project: oil, gas, electricity access." },
    { title: "Anki (spaced repetition)", url: "https://apps.ankiweb.net/", category: "tool", note: "Free flashcard app for the active-recall system." },
    { title: "Scholars4Dev: scholarship listings", url: "https://www.scholars4dev.com/", category: "other", note: "Well-maintained list of fully funded scholarships for developing-country students." },
    { title: "Opportunity Desk", url: "https://opportunitydesk.org/", category: "other", note: "Daily-updated opportunities: scholarships, fellowships, competitions." },
  ];
  for (const r of resources) await seedResource(r);
  console.log("Resources ensured.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
