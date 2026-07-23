import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import {
  MONTH_THEMES,
  PROGRAM_WEEKS,
  monthOfWeek,
  programProgressPct,
  programWeek,
} from "@/lib/mentorship/constants";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardTitle,
  EmptyState,
  Pill,
  Stat,
} from "@/components/mentorship/ui";
import { ProgressRing } from "@/components/mentorship/ProgressRing";
import { WeekStrip } from "@/components/mentorship/WeekStrip";

export default async function PortalOverviewPage() {
  const mentee = await verifyMentee();
  const week = programWeek();
  const inProgram = week >= 1 && week <= PROGRAM_WEEKS;
  const month = inProgram ? monthOfWeek(week) : week === 0 ? 1 : 3;
  const theme = MONTH_THEMES[month];
  const now = new Date();

  const [
    openTasks,
    goals,
    myCheckinThisWeek,
    nextSession,
    latestAnnouncement,
    unreadFromMentor,
    cohortSize,
    cohortCheckinsThisWeek,
    myCheckinWeeks,
  ] = await Promise.all([
    prisma.mentorshipTask.count({
      where: { menteeId: mentee.id, status: "todo" },
    }),
    prisma.mentorshipGoal.findMany({
      where: { menteeId: mentee.id, status: { not: "dropped" } },
      orderBy: { createdAt: "asc" },
    }),
    inProgram
      ? prisma.mentorshipCheckin.findFirst({
          where: { menteeId: mentee.id, week },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.mentorshipSession.findFirst({
      where: {
        status: "upcoming",
        scheduledAt: { gte: now },
        OR: [{ menteeId: null }, { menteeId: mentee.id }],
      },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.mentorshipAnnouncement.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.mentorshipMessage.count({
      where: { menteeId: mentee.id, sender: "mentor", readAt: null },
    }),
    prisma.mentorshipMentee.count({ where: { active: true } }),
    inProgram
      ? prisma.mentorshipCheckin.groupBy({
          by: ["menteeId"],
          where: { week },
        })
      : Promise.resolve([]),
    prisma.mentorshipCheckin.findMany({
      where: { menteeId: mentee.id },
      select: { week: true },
    }),
  ]);

  const completedGoals = goals.filter((g) => g.status === "completed").length;
  const firstName = mentee.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-zinc-400">
          {inProgram ? (
            <>
              Week {week} of {PROGRAM_WEEKS} · Month {month}:{" "}
              <span className="text-zinc-300">{theme.title}</span>
            </>
          ) : week === 0 ? (
            "The programme has not kicked off yet. Get ready!"
          ) : (
            "The programme has wrapped. Your portal remains open."
          )}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="grid items-center gap-8 md:grid-cols-[auto_1fr]">
          <div className="mx-auto">
            <ProgressRing pct={programProgressPct()} label="of the journey" />
          </div>
          <div className="min-w-0">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                Your journey
              </p>
              {inProgram ? (
                <p className="text-xs text-zinc-500">
                  Week {week} of {PROGRAM_WEEKS}
                </p>
              ) : null}
            </div>
            <WeekStrip
              currentWeek={week}
              checkedWeeks={myCheckinWeeks.map((c) => c.week)}
            />
            <p className="mt-5 text-sm leading-relaxed text-zinc-400">
              {theme.blurb}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Open tasks"
          value={openTasks}
          hint={openTasks === 0 ? "All clear" : "Waiting on you"}
        />
        <Stat
          label="Goals"
          value={`${completedGoals} / ${goals.length}`}
          hint="completed"
        />
        <Stat
          label="This week's check-in"
          value={
            !inProgram ? (
              <Pill tone="neutral">n/a</Pill>
            ) : myCheckinThisWeek ? (
              <Pill tone="green">Done</Pill>
            ) : (
              <Pill tone="amber">Due</Pill>
            )
          }
          hint={
            inProgram && !myCheckinThisWeek ? "A few minutes, big payoff" : undefined
          }
        />
        <Stat
          label="Unread from mentor"
          value={unreadFromMentor}
          hint={unreadFromMentor > 0 ? "Check your messages" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle kicker="Next session" title={nextSession ? nextSession.title : "Nothing scheduled yet"} />
          {nextSession ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="accent">
                  {nextSession.kind === "group" ? "Group session" : "One on one"}
                </Pill>
                <span className="text-sm text-zinc-300">
                  {formatDateTime(nextSession.scheduledAt)}
                </span>
              </div>
              {nextSession.agenda ? (
                <p className="text-sm leading-relaxed text-zinc-400">
                  {nextSession.agenda}
                </p>
              ) : null}
              {nextSession.link ? (
                <a
                  href={nextSession.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
                >
                  Join call
                </a>
              ) : null}
            </div>
          ) : (
            <EmptyState>
              Your mentor will schedule the next session soon.{" "}
              <Link href="/mentorship/portal/sessions" className="text-accent hover:underline">
                See all sessions
              </Link>
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardTitle
            kicker="Announcement"
            title={latestAnnouncement ? latestAnnouncement.title : "No announcements yet"}
          />
          {latestAnnouncement ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
              {latestAnnouncement.body}
            </p>
          ) : (
            <EmptyState>Cohort announcements will appear here.</EmptyState>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle
          kicker="Cohort pulse"
          title={
            inProgram
              ? `${cohortCheckinsThisWeek.length} of ${cohortSize} mentees have checked in this week`
              : `${cohortSize} mentees in the cohort`
          }
        />
        <p className="text-sm text-zinc-500">
          Progress is personal, but momentum is shared. Keep each other honest.
        </p>
        {inProgram && !myCheckinThisWeek ? (
          <Link
            href="/mentorship/portal/checkins"
            className="mt-4 inline-block rounded-full bg-gradient-to-r from-accent to-accent-2 px-5 py-2 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90"
          >
            Do your week {week} check-in
          </Link>
        ) : null}
      </Card>
    </div>
  );
}
