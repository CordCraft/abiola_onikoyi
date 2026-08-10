import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { getPlanState, type PlanDayWithTasks } from "@/lib/mentorship/plan";
import {
  PROGRAM_WEEKS,
  monthOfWeek,
  MONTH_THEMES,
  PLAN_KIND_LABELS,
  type PlanTaskKind,
} from "@/lib/mentorship/constants";
import { Card, Pill } from "@/components/mentorship/ui";
import {
  PlanDayCommentFormDark,
  PlanTaskCommentFormDark,
} from "@/components/mentorship/admin-plan-forms";

export const metadata = { title: "Mirror view" };

// Reuses the exact visual language of /mentorship/portal/program (the
// mentee's own daily programme screen) so the mentor sees precisely what
// the mentee sees, minus the mutation controls that belong to the mentee
// alone (marking tasks done, submitting evidence, closing out the day).
// Mentor replies use the same server actions as the plain-text admin view.

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const KIND_TONES: Record<PlanTaskKind, string> = {
  mindset: "bg-purple-500/10 text-purple-300",
  skill: "bg-sky-500/10 text-sky-300",
  project: "bg-emerald-500/10 text-emerald-300",
  career: "bg-amber-500/10 text-amber-300",
  checkpoint: "bg-red-500/10 text-red-300",
};

type MirrorTask = PlanDayWithTasks["tasks"][number];

function MirrorTaskItem({ task }: { task: MirrorTask }) {
  const done = task.status === "done";
  const kind = (task.kind in KIND_TONES ? task.kind : "skill") as PlanTaskKind;

  return (
    <li
      className={`rounded-xl border p-4 transition-colors ${
        done
          ? "border-emerald-500/20 bg-emerald-500/[0.05]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border ${
            done
              ? "border-emerald-400 bg-emerald-400 text-zinc-950"
              : "border-white/25"
          }`}
        >
          {done ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${KIND_TONES[kind]}`}
            >
              {PLAN_KIND_LABELS[kind]}
            </span>
            <span className="text-[11px] text-zinc-500">
              ~{task.minutes} min · {task.points} pts
            </span>
          </div>
          <p
            className={`mt-1 text-sm font-medium ${
              done ? "text-zinc-400 line-through decoration-emerald-400/40" : "text-white"
            }`}
          >
            {task.title}
          </p>
          {task.detail ? (
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{task.detail}</p>
          ) : null}

          {task.evidence ? (
            <div className="mt-2 rounded-lg bg-white/[0.04] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Their evidence
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-zinc-300">
                {task.evidence}
              </p>
              {!task.mentorComment ? <PlanTaskCommentFormDark taskId={task.id} /> : null}
            </div>
          ) : null}

          {task.mentorComment ? (
            <div className="mt-2 rounded-lg border border-accent/20 bg-accent/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">You</p>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                {task.mentorComment}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function MirrorDayCard({
  day,
  locked,
  isToday,
}: {
  day: PlanDayWithTasks;
  locked: boolean;
  isToday: boolean;
}) {
  const done = day.tasks.filter((t) => t.status === "done").length;
  const total = day.tasks.length;
  const points = day.tasks
    .filter((t) => t.status === "done")
    .reduce((s, t) => s + t.points, 0);

  return (
    <details
      open={isToday || Boolean(day.completedAt)}
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
        {locked ? <Pill tone="neutral">Locked for them</Pill> : null}
        <span className="text-zinc-600 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <ul className="space-y-2">
          {day.tasks.map((t) => (
            <MirrorTaskItem key={t.id} task={t} />
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
                  You
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                  {day.mentorComment}
                </p>
              </div>
            ) : (
              <div className="mt-3 border-t border-white/10 pt-3">
                <PlanDayCommentFormDark dayId={day.id} />
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-zinc-500">
            Not closed out yet — they haven&apos;t submitted this day&apos;s reflection.
          </p>
        )}
      </div>
    </details>
  );
}

export default async function MenteeProgramMirrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  await verifySession();
  await ensureMentorshipTables();
  const { id } = await params;
  const sp = await searchParams;

  const mentee = await prisma.mentorshipMentee.findUnique({
    where: { id },
    select: { id: true, name: true, track: true },
  });
  if (!mentee) notFound();

  const state = await getPlanState(id);

  const notStarted = state.todayIndex === 0;
  const wrapped = state.todayIndex > 91;
  const defaultWeek = notStarted
    ? 1
    : Math.min(state.currentWeek, state.unlockedWeek || 1);
  const requested = Number(sp.week);
  const selectedWeek =
    state.hasPlan && requested >= 1 && requested <= PROGRAM_WEEKS
      ? Math.min(requested, state.visibleWeek)
      : defaultWeek;

  const weekDays = state.days.filter((d) => d.week === selectedWeek);
  const weekLocked = notStarted || selectedWeek > state.unlockedWeek;
  const monthTheme = MONTH_THEMES[monthOfWeek(selectedWeek)];
  const pctDone =
    state.tasksTotal > 0
      ? Math.round((state.tasksDone / state.tasksTotal) * 100)
      : 0;

  const unlockHint =
    weekLocked && !notStarted && selectedWeek === state.unlockedWeek + 1
      ? selectedWeek > state.currentWeek
        ? `Week ${selectedWeek} opens for them on ${dayFmt.format(
            state.days.find((d) => d.week === selectedWeek)?.date ?? new Date(),
          )}. They can preview the tasks now.`
        : `They unlock this week by submitting their week ${state.unlockedWeek} check-in. Your reply is never required for them to proceed.`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/mentorship/${mentee.id}`}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {mentee.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Mirror view
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Exactly what {mentee.name.split(" ")[0]} sees on their Daily Programme
          screen right now. Replies here reach them the same way your comments
          always do.
        </p>
      </div>

      <div
        className="-mx-2 rounded-3xl p-4 sm:mx-0 sm:p-8"
        style={{ background: "#05060a", colorScheme: "dark" }}
      >
        {!state.hasPlan ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">
            No programme has been generated for them yet.
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Daily programme
              </h2>
              <p className="mt-1 text-zinc-400">
                {mentee.track ? `${mentee.track} · ` : ""}
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
                  <span className="text-sm font-normal text-zinc-500"> / {state.pointsTotal}</span>
                </p>
                <p className="mt-1 text-xs text-zinc-500">earned across the programme</p>
              </div>
              <div className="glass glow-card rounded-2xl p-5">
                <p className="text-sm text-zinc-400">Tasks</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
                  {state.tasksDone}
                  <span className="text-sm font-normal text-zinc-500"> / {state.tasksTotal}</span>
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
                      title="Unlocks for them as they progress"
                      className="cursor-not-allowed rounded-full border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-700"
                    >
                      W{w} 🔒
                    </span>
                  );
                }
                return (
                  <Link
                    key={w}
                    href={`/dashboard/mentorship/${mentee.id}/program?week=${w}`}
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
                {weekLocked ? <Pill tone="amber">Preview · locked for them</Pill> : null}
              </div>

              {unlockHint ? (
                <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
                  {unlockHint}
                </p>
              ) : null}

              {weekDays.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">
                  This week hasn&apos;t been generated for them yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {weekDays.map((day) => (
                    <MirrorDayCard
                      key={day.id}
                      day={day}
                      locked={weekLocked}
                      isToday={!notStarted && !wrapped && day.dayIndex === state.todayIndex}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
