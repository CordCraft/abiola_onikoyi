import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { Card, EmptyState, Pill } from "@/components/mentorship/ui";
import { formatDateTime } from "@/lib/format";
import type { MentorshipSession } from "@prisma/client";

function SessionCard({ session }: { session: MentorshipSession }) {
  const past = session.status !== "upcoming" || session.scheduledAt < new Date();
  return (
    <Card className={past ? "opacity-75" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-white">{session.title}</h2>
          <Pill tone={session.kind === "group" ? "accent" : "neutral"}>
            {session.kind === "group" ? "Group" : "One on one"}
          </Pill>
          {session.status === "cancelled" ? <Pill tone="red">Cancelled</Pill> : null}
          {session.status === "completed" ? <Pill tone="green">Held</Pill> : null}
        </div>
        <span className="text-sm text-zinc-400">
          {formatDateTime(session.scheduledAt)}
        </span>
      </div>
      {session.agenda ? (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{session.agenda}</p>
      ) : null}
      {session.notes ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Session notes
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
            {session.notes}
          </p>
        </div>
      ) : null}
      {!past && session.link ? (
        <a
          href={session.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
        >
          Join call
        </a>
      ) : null}
    </Card>
  );
}

export default async function SessionsPage() {
  const mentee = await verifyMentee();
  const now = new Date();

  const sessions = await prisma.mentorshipSession.findMany({
    where: { OR: [{ menteeId: null }, { menteeId: mentee.id }] },
    orderBy: { scheduledAt: "asc" },
  });

  const upcoming = sessions.filter(
    (s) => s.status === "upcoming" && s.scheduledAt >= now,
  );
  const past = sessions
    .filter((s) => s.status !== "upcoming" || s.scheduledAt < now)
    .reverse();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Sessions
        </h1>
        <p className="mt-1 text-zinc-400">
          Group sessions with the cohort and your private one-on-ones.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState>Nothing on the calendar yet. Check back soon.</EmptyState>
        ) : (
          upcoming.map((s) => <SessionCard key={s.id} session={s} />)
        )}
      </div>

      {past.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Past
          </h2>
          {past.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
