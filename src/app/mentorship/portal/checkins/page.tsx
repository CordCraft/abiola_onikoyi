import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { PROGRAM_WEEKS, programWeek } from "@/lib/mentorship/constants";
import { CheckinForm } from "@/components/mentorship/forms";
import { Card, CardTitle, EmptyState, Pill } from "@/components/mentorship/ui";
import { formatDate } from "@/lib/format";

export default async function CheckinsPage() {
  const mentee = await verifyMentee();
  const week = programWeek();
  const inProgram = week >= 1 && week <= PROGRAM_WEEKS;

  const checkins = await prisma.mentorshipCheckin.findMany({
    where: { menteeId: mentee.id },
    orderBy: { week: "desc" },
  });

  const thisWeekDone = checkins.some((c) => c.week === week);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Weekly check-ins
        </h1>
        <p className="mt-1 text-zinc-400">
          A few honest minutes each week. Your mentor reads every one and replies
          right here.
        </p>
      </div>

      {inProgram && !thisWeekDone ? (
        <Card>
          <CardTitle kicker={`Week ${week}`} title="This week's check-in" />
          <CheckinForm week={week} />
        </Card>
      ) : inProgram && thisWeekDone ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Week {week} check-in done. Next one opens when the new week starts.
        </p>
      ) : week === 0 ? (
        <EmptyState>Check-ins open when the programme kicks off.</EmptyState>
      ) : (
        <EmptyState>The programme has wrapped. Your history stays here.</EmptyState>
      )}

      <div className="space-y-4">
        {checkins.length === 0 ? null : (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            History
          </h2>
        )}
        {checkins.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Pill tone="accent">Week {c.week}</Pill>
                {c.confidence ? (
                  <span className="text-xs text-zinc-500">
                    Confidence {c.confidence}/5
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-zinc-500">{formatDate(c.createdAt)}</span>
            </div>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-zinc-300">Wins</dt>
                <dd className="mt-0.5 whitespace-pre-line leading-relaxed text-zinc-400">
                  {c.wins}
                </dd>
              </div>
              {c.blockers ? (
                <div>
                  <dt className="font-medium text-zinc-300">Blockers</dt>
                  <dd className="mt-0.5 whitespace-pre-line leading-relaxed text-zinc-400">
                    {c.blockers}
                  </dd>
                </div>
              ) : null}
              {c.nextFocus ? (
                <div>
                  <dt className="font-medium text-zinc-300">Next focus</dt>
                  <dd className="mt-0.5 whitespace-pre-line leading-relaxed text-zinc-400">
                    {c.nextFocus}
                  </dd>
                </div>
              ) : null}
            </dl>
            {c.mentorReply ? (
              <div className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.06] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  Mentor&apos;s reply
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                  {c.mentorReply}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-xs text-zinc-600">
                Awaiting your mentor&apos;s reply.
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
