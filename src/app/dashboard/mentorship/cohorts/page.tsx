import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { clockFor, listCohorts } from "@/lib/mentorship/cohorts";
import { PROGRAM_DAYS, PROGRAM_WEEKS } from "@/lib/mentorship/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatLongDate } from "@/lib/mentorship/calendar";
import { CohortForm } from "@/components/mentorship/admin-forms";
import { SubmitButton } from "@/components/SubmitButton";
import { setCohortClosed } from "@/app/dashboard/mentorship/actions";

export const metadata = { title: "Cohorts" };

// "2026-12-01T09:00" in WAT for a datetime-local input.
function watInput(d: Date | null): string {
  if (!d) return "";
  return new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default async function CohortsPage() {
  await verifySession();
  await ensureMentorshipTables();

  const cohorts = await listCohorts();
  const stats = await prisma.mentorshipMentee.groupBy({
    by: ["cohort", "active"],
    _count: { _all: true },
  });
  const pending = await prisma.mentorshipCheckin.findMany({
    where: { mentorReply: null },
    select: { mentee: { select: { cohort: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard/mentorship" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Mentorship
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Cohorts</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Each cohort runs on its own calendar: a kickoff call, then {PROGRAM_WEEKS} weeks (
          {PROGRAM_DAYS} days) of daily programme from day 1, Saturday to Friday. New sign-ups
          join the next cohort that has not started.
        </p>
      </div>

      <div className="space-y-4">
        {cohorts.map((c) => {
          const clock = clockFor(c);
          const active = stats.find((s) => s.cohort === c.id && s.active)?._count._all ?? 0;
          const inactive = stats.find((s) => s.cohort === c.id && !s.active)?._count._all ?? 0;
          const open = pending.filter((p) => p.mentee.cohort === c.id).length;
          return (
            <section key={c.id} className="rounded-2xl border border-zinc-200 bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    {c.label}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        clock.closed
                          ? "bg-zinc-200 text-zinc-600"
                          : clock.week === 0
                            ? "bg-sky-100 text-sky-700"
                            : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {clock.closed ? "closed" : clock.week === 0 ? "upcoming" : clock.inProgram ? `week ${clock.week}` : "finished"}
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    {c.kickoffAt ? `Kickoff ${formatDateTime(c.kickoffAt)} · ` : ""}
                    Day 1 {formatLongDate(c.startDate)} · ends {formatLongDate(clock.endDate)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {active} active · {inactive} inactive
                    {open > 0 && !clock.closed ? ` · ${open} check-in${open === 1 ? "" : "s"} unanswered` : ""}
                    {c.closedAt ? ` · closed ${formatDate(c.closedAt)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/mentorship?cohort=${c.id}`}
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    View mentees
                  </Link>
                  <form action={setCohortClosed}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="close" value={clock.closed ? "false" : "true"} />
                    <SubmitButton
                      pendingLabel={clock.closed ? "Reopening…" : "Closing…"}
                      className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
                        clock.closed
                          ? "border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                          : "bg-zinc-900 text-white hover:bg-zinc-700"
                      }`}
                    >
                      {clock.closed ? "Reopen cohort" : "Close cohort"}
                    </SubmitButton>
                  </form>
                </div>
              </div>
              {!clock.closed ? (
                <p className="mt-3 text-xs text-zinc-400">
                  Closing switches off portal access for everyone in this cohort and clears their
                  unanswered check-ins from your queue. Nothing is deleted; reopening restores access.
                  Move anyone who should carry on into another cohort first (from their page).
                </p>
              ) : null}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-zinc-700">Edit name and dates</summary>
                <div className="mt-3">
                  <CohortForm
                    defaults={{
                      id: c.id,
                      label: c.label,
                      startDate: c.startDate.toISOString().slice(0, 10),
                      kickoffAt: watInput(c.kickoffAt),
                    }}
                  />
                  <p className="mt-2 text-xs text-zinc-400">
                    Changing day 1 re-dates every member&apos;s daily programme.
                  </p>
                </div>
              </details>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">New cohort</h2>
        <div className="mt-4">
          <CohortForm />
        </div>
      </section>
    </div>
  );
}
