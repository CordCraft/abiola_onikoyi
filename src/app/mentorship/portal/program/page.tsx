import Link from "next/link";
import { verifyMentee } from "@/lib/mentorship/dal";
import { getPlanState, type PlanDayWithTasks } from "@/lib/mentorship/plan";
import {
  PROGRAM_WEEKS,
  lagosDate,
  monthOfWeek,
  MONTH_THEMES,
} from "@/lib/mentorship/constants";
import { Card, EmptyState, Pill } from "@/components/mentorship/ui";
import {
  CloseDayForm,
  PlanTaskItem,
} from "@/components/mentorship/plan-forms";

export const metadata = { title: "Daily Programme" };

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function DayCard({
  day,
  locked,
  isToday,
  canClose,
}: {
  day: PlanDayWithTasks;
  locked: boolean;
  isToday: boolean;
  canClose: boolean;
}) {
  const done = day.tasks.filter((t) => t.status === "done").length;
  const total = day.tasks.length;
  const points = day.tasks
    .filter((t) => t.status === "done")
    .reduce((s, t) => s + t.points, 0);

  return (
    <details
      open={isToday}
      className={`group rounded-2xl border transition-colors ${
        isToday
          ? "border-accent/40 bg-accent/[0.04]"
          : day.completedAt
            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
            : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${
            day.completedAt
              ? "bg-emerald-400 text-zinc-950"
              : isToday
                ? "bg-accent text-zinc-950"
                : "bg-white/[0.06] text-zinc-400"
          }`}
        >
          {day.completedAt ? "✓" : day.dayIndex}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {day.title}
            {isToday ? (
              <span className="ml-2 text-xs font-bold uppercase tracking-wider text-accent">
                Today
              </span>
            ) : null}
          </p>
          <p className="text-xs text-zinc-500">
            {dayFmt.format(day.date)} · Day {day.dayIndex} of 91 · {done}/{total}{" "}
            tasks{points > 0 ? ` · ${points} pts` : ""}
          </p>
        </div>
        {locked ? <Pill tone="neutral">Locked</Pill> : null}
        <span className="text-zinc-600 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <ul className="space-y-2">
          {day.tasks.map((t) => (
            <PlanTaskItem
              key={t.id}
              locked={locked}
              task={{
                id: t.id,
                kind: t.kind,
                title: t.title,
                detail: t.detail,
                minutes: t.minutes,
                points: t.points,
                evidenceHint: t.evidenceHint,
                status: t.status,
                evidence: t.evidence,
                mentorComment: t.mentorComment,
              }}
            />
          ))}
        </ul>
        {day.completedAt ? (
          <div className="rounded-xl bg-emerald-500/[0.07] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Day closed out{day.confidence ? ` · confidence ${day.confidence}/5` : ""}
            </p>
            {day.reflection ? (
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                {day.reflection}
              </p>
            ) : null}
            {day.mentorComment ? (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Mentor
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                  {day.mentorComment}
                </p>
              </div>
            ) : null}
          </div>
        ) : canClose ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Daily check-in
            </p>
            <CloseDayForm dayId={day.id} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default async function ProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const mentee = await verifyMentee();
  const state = await getPlanState(mentee.id);
  const params = await searchParams;

  if (!state.hasPlan) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Daily programme
        </h1>
        <EmptyState>
          Your personalised 91-day programme is being prepared by your mentor.
          Check back soon.
        </EmptyState>
      </div>
    );
  }

  const notStarted = state.todayIndex === 0;
  const wrapped = state.todayIndex > 91;
  const defaultWeek = notStarted
    ? 1
    : Math.min(state.currentWeek, state.unlockedWeek || 1);
  const requested = Number(params.week);
  const selectedWeek =
    requested >= 1 && requested <= PROGRAM_WEEKS
      ? Math.min(requested, state.visibleWeek)
      : defaultWeek;

  const weekDays = state.days.filter((d) => d.week === selectedWeek);
  const weekLocked = notStarted || selectedWeek > state.unlockedWeek;
  const today = lagosDate().getTime();
  const monthTheme = MONTH_THEMES[monthOfWeek(selectedWeek)];
  const pctDone =
    state.tasksTotal > 0
      ? Math.round((state.tasksDone / state.tasksTotal) * 100)
      : 0;

  // What unlocks the currently locked week, if it is the preview week.
  const unlockHint =
    weekLocked && !notStarted && selectedWeek === state.unlockedWeek + 1
      ? selectedWeek > state.currentWeek
        ? `Week ${selectedWeek} opens on ${dayFmt.format(
            state.days.find((d) => d.week === selectedWeek)?.date ?? new Date(),
          )}. You can preview the tasks now.`
        : `Submit your week ${state.unlockedWeek} check-in to unlock this week. Your mentor's reply is never required to proceed.`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Daily programme
        </h1>
        <p className="mt-1 text-zinc-400">
          {notStarted
            ? "Day 1 lands on Saturday 1 August. Preview week 1 below and come ready."
            : wrapped
              ? "The 91 days are complete. Your record stays here."
              : `Day ${state.todayIndex} of 91 · built from your story, one day at a time.`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass glow-card rounded-2xl p-5">
          <p className="text-sm text-zinc-400">Streak</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {state.streak > 0 ? `🔥 ${state.streak}` : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {state.streak > 0
              ? `${state.streak} day${state.streak === 1 ? "" : "s"} closed out in a row`
              : "Close out today to start one"}
          </p>
        </div>
        <div className="glass glow-card rounded-2xl p-5">
          <p className="text-sm text-zinc-400">Points</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {state.pointsEarned}
            <span className="text-sm font-normal text-zinc-500">
              {" "}/ {state.pointsTotal}
            </span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">earned across the programme</p>
        </div>
        <div className="glass glow-card rounded-2xl p-5">
          <p className="text-sm text-zinc-400">Tasks</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {state.tasksDone}
            <span className="text-sm font-normal text-zinc-500">
              {" "}/ {state.tasksTotal}
            </span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">{pctDone}% of the journey done</p>
        </div>
        <div className="glass glow-card rounded-2xl p-5">
          <p className="text-sm text-zinc-400">Week</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {notStarted ? "—" : state.currentWeek}
            <span className="text-sm font-normal text-zinc-500"> / {PROGRAM_WEEKS}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {monthTheme ? `Month ${monthOfWeek(selectedWeek)}: ${monthTheme.title}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: PROGRAM_WEEKS }, (_, i) => i + 1).map((w) => {
          const isVisible = w <= state.visibleWeek;
          const isLocked = notStarted || w > state.unlockedWeek;
          const isSelected = w === selectedWeek;
          if (!isVisible) {
            return (
              <span
                key={w}
                title="Unlocks as you progress"
                className="cursor-not-allowed rounded-full border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                W{w} 🔒
              </span>
            );
          }
          return (
            <Link
              key={w}
              href={`/mentorship/portal/program?week=${w}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-gradient-to-r from-accent/25 to-accent-2/25 text-white shadow-[inset_0_0_0_1px] shadow-accent/40"
                  : "border border-white/10 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              W{w}
              {isLocked ? " 🔒" : ""}
            </Link>
          );
        })}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Week {selectedWeek}
            </p>
            {weekDays[0]?.mindset ? (
              <p className="mt-1 text-sm italic leading-relaxed text-zinc-400">
                “{weekDays[0].mindset}”
              </p>
            ) : null}
          </div>
          {weekLocked ? <Pill tone="amber">Preview · locked</Pill> : null}
        </div>

        {unlockHint ? (
          <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            {unlockHint}
            {selectedWeek === state.unlockedWeek + 1 &&
            selectedWeek <= state.currentWeek ? (
              <>
                {" "}
                <Link
                  href="/mentorship/portal/checkins"
                  className="font-semibold underline underline-offset-2"
                >
                  Do it now
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : null}

        <div className="space-y-3">
          {weekDays.map((day) => (
            <DayCard
              key={day.id}
              day={day}
              locked={weekLocked}
              isToday={!notStarted && !wrapped && day.dayIndex === state.todayIndex}
              canClose={
                !weekLocked &&
                !day.completedAt &&
                day.date.getTime() <= today
              }
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
