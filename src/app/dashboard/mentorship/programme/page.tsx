import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  AnnouncementForm,
  ResourceForm,
  SessionForm,
} from "@/components/mentorship/admin-forms";
import {
  deleteAnnouncement,
  deleteMentorshipSession,
  deleteResource,
  updateMentorshipSession,
} from "@/app/dashboard/mentorship/actions";
import { listCohorts } from "@/lib/mentorship/cohorts";
import { googleCalendarUrl } from "@/lib/mentorship/calendar";

export const metadata = { title: "Programme admin" };

const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100";

export default async function ProgrammeAdminPage() {
  await verifySession();
  await ensureMentorshipTables();

  const cohortRows = await listCohorts();
  const cohorts = cohortRows.map((c) => ({
    id: c.id,
    label: c.label,
    closed: c.status === "closed",
  }));
  const cohortLabel = (id: string | null) =>
    id ? (cohortRows.find((c) => c.id === id)?.label ?? id) : "Every cohort";
  const now = new Date();

  const [allSessions, resources, announcements, mentees] = await Promise.all([
    prisma.mentorshipSession.findMany({
      orderBy: { scheduledAt: "desc" },
      include: { mentee: { select: { name: true } } },
    }),
    prisma.mentorshipResource.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    }),
    prisma.mentorshipAnnouncement.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.mentorshipMentee.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // Upcoming first (soonest at the top), then the history.
  const sessions = [
    ...allSessions
      .filter((s) => s.status === "upcoming" && s.scheduledAt >= now)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()),
    ...allSessions.filter((s) => !(s.status === "upcoming" && s.scheduledAt >= now)),
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard/mentorship"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Mentorship
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Sessions, resources & announcements
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Group sessions and announcements go to every cohort or the one you
          pick; one-on-ones only to the mentee involved. Resources are shared
          with everyone.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Schedule a session</h2>
        <div className="mt-4">
          <SessionForm mentees={mentees} cohorts={cohorts} />
        </div>
        {sessions.length > 0 ? (
          <ul className="mt-6 divide-y divide-zinc-100">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {s.title}
                    <span className="ml-2 text-xs text-zinc-500">
                      {s.kind === "group"
                        ? `Group · ${cohortLabel(s.cohort)}`
                        : `One on one · ${s.mentee?.name ?? "?"}`}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatDateTime(s.scheduledAt)} ·{" "}
                    <span
                      className={
                        s.status === "upcoming" && s.scheduledAt < now
                          ? "font-medium text-amber-700"
                          : ""
                      }
                    >
                      {s.status === "upcoming" && s.scheduledAt < now
                        ? "past, mark held or cancelled"
                        : s.status}
                    </span>
                    {s.status === "upcoming" && s.scheduledAt >= now ? (
                      <>
                        {" · "}
                        <a
                          href={googleCalendarUrl({
                            title: s.title,
                            start: s.scheduledAt,
                            details: s.agenda,
                            location: s.link,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          add to calendar
                        </a>
                      </>
                    ) : null}
                    {s.link ? (
                      <>
                        {" · "}
                        <a
                          href={s.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          link
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  {s.status === "upcoming" ? (
                    <>
                      <form action={updateMentorshipSession}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="status" value="completed" />
                        <SubmitButton className={`${smallButton} disabled:opacity-60`}>
                          Mark held
                        </SubmitButton>
                      </form>
                      <form action={updateMentorshipSession}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="status" value="cancelled" />
                        <SubmitButton className={`${smallButton} disabled:opacity-60`}>
                          Cancel
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                  <form action={deleteMentorshipSession}>
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton
                      spinnerClassName="h-3 w-3"
                      className="text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-60"
                    >
                      Delete
                    </SubmitButton>
                  </form>
                </div>
                {s.status === "completed" && !s.notes ? (
                  <form
                    action={updateMentorshipSession}
                    className="flex w-full items-center gap-2"
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      name="notes"
                      placeholder="Add session notes for attendees…"
                      className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                    />
                    <SubmitButton className={`${smallButton} disabled:opacity-60`}>
                      Save notes
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Share a resource</h2>
        <div className="mt-4">
          <ResourceForm />
        </div>
        {resources.length > 0 ? (
          <ul className="mt-6 divide-y divide-zinc-100">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {r.pinned ? "📌 " : null}
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                    <span className="ml-2 text-xs text-zinc-400">{r.category}</span>
                  </p>
                  {r.note ? <p className="text-xs text-zinc-500">{r.note}</p> : null}
                </div>
                <form action={deleteResource}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton
                    spinnerClassName="h-3 w-3"
                    className="text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-60"
                  >
                    Delete
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Post an announcement</h2>
        <div className="mt-4">
          <AnnouncementForm cohorts={cohorts} />
        </div>
        {announcements.length > 0 ? (
          <ul className="mt-6 divide-y divide-zinc-100">
            {announcements.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-900">
                    {a.title}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {cohortLabel(a.cohort)}
                    </span>
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400">
                      {formatDate(a.createdAt)}
                    </span>
                    <form action={deleteAnnouncement}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton
                        spinnerClassName="h-3 w-3"
                        className="text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-60"
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-600">
                  {a.body}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
