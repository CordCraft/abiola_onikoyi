import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { PROGRAM_DAYS, PROGRAM_WEEKS, daysUntil } from "@/lib/mentorship/constants";
import {
  clockFor,
  currentIntakeCohort,
  derivedStatus,
  listCohorts,
} from "@/lib/mentorship/cohorts";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatLongDate } from "@/lib/mentorship/calendar";

export const metadata = { title: "Mentorship admin" };

const DAY = 86_400_000;

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function ago(d: Date | null | undefined): string {
  if (!d) return "Never";
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

const STATUS_STYLE: Record<string, string> = {
  "Not registered": "bg-zinc-100 text-zinc-600",
  Ready: "bg-sky-100 text-sky-700",
  "On track": "bg-emerald-100 text-emerald-700",
  Behind: "bg-amber-100 text-amber-800",
  Quiet: "bg-red-100 text-red-700",
  Closed: "bg-zinc-200 text-zinc-500",
  Inactive: "bg-zinc-200 text-zinc-500",
};

export default async function MentorshipAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string; inactive?: string }>;
}) {
  await verifySession();
  // First visit after deploy creates the tables if missing.
  await ensureMentorshipTables();
  const sp = await searchParams;

  const cohorts = await listCohorts();
  const intake = await currentIntakeCohort();
  const selectedId =
    sp.cohort === "all"
      ? "all"
      : (cohorts.find((c) => c.id === sp.cohort)?.id ?? intake.id);
  const selected = selectedId === "all" ? null : cohorts.find((c) => c.id === selectedId)!;
  const clock = selected ? clockFor(selected) : null;
  const showInactive = sp.inactive === "1" || (selected?.status === "closed");
  const closedIds = cohorts.filter((c) => c.status === "closed").map((c) => c.id);
  const now = new Date();

  const menteeWhere = {
    ...(selected ? { cohort: selected.id } : {}),
    ...(showInactive ? {} : { active: true }),
  };

  const [mentees, pendingCheckins, unreadCounts, nextSession, reviewTasks, reviewDays, cohortCounts] =
    await Promise.all([
      prisma.mentorshipMentee.findMany({
        where: menteeWhere,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          cohort: true,
          active: true,
          photoData: true,
          focusArea: true,
          track: true,
          passwordHash: true,
          onboardedAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              tasks: { where: { status: "todo" } },
              goals: { where: { status: "active" } },
            },
          },
          checkins: {
            orderBy: { week: "desc" },
            select: { week: true, createdAt: true },
          },
          planDays: {
            where: { completedAt: { not: null } },
            orderBy: { completedAt: "desc" },
            take: 1,
            select: { completedAt: true },
          },
        },
      }),
      // Only live mentees in open cohorts need a reply; a closed cohort's
      // leftovers drop out on their own.
      prisma.mentorshipCheckin.findMany({
        where: {
          mentorReply: null,
          mentee: { active: true, cohort: { notIn: closedIds } },
        },
        orderBy: { createdAt: "asc" },
        include: { mentee: { select: { id: true, name: true } } },
      }),
      prisma.mentorshipMessage.groupBy({
        by: ["menteeId"],
        where: { sender: "mentee", readAt: null, mentee: { active: true } },
        _count: { _all: true },
      }),
      prisma.mentorshipSession.findFirst({
        where: {
          status: "upcoming",
          scheduledAt: { gte: now },
          ...(selected
            ? {
                OR: [
                  { cohort: selected.id },
                  { cohort: null, menteeId: null },
                  { mentee: { cohort: selected.id } },
                ],
              }
            : {}),
        },
        orderBy: { scheduledAt: "asc" },
        include: { mentee: { select: { name: true } } },
      }),
      prisma.mentorshipPlanTask.count({
        where: {
          evidence: { not: null },
          mentorComment: null,
          day: { mentee: { active: true } },
        },
      }),
      prisma.mentorshipPlanDay.count({
        where: {
          completedAt: { not: null },
          mentorComment: null,
          mentee: { active: true },
        },
      }),
      prisma.mentorshipMentee.groupBy({
        by: ["cohort"],
        _count: { _all: true },
      }),
    ]);

  const sizeByCohort = new Map(cohortCounts.map((c) => [c.cohort, c._count._all]));
  const unreadByMentee = new Map(unreadCounts.map((u) => [u.menteeId, u._count._all]));
  const totalUnread = unreadCounts.reduce((sum, u) => sum + u._count._all, 0);
  const activeCount = mentees.filter((m) => m.active).length;
  const clocksById = new Map(cohorts.map((c) => [c.id, clockFor(c, now)]));

  const rows = mentees.map((m) => {
    const c = clocksById.get(m.cohort) ?? clock;
    const lastCheckin = m.checkins[0];
    const checkinWeeks = new Set(m.checkins.map((x) => x.week));
    // Check-ins owed: every week the calendar has fully finished.
    const finishedWeeks = c ? Math.min(Math.max(c.week - 1, 0), PROGRAM_WEEKS) : 0;
    let missed = 0;
    for (let w = 1; w <= finishedWeeks; w++) if (!checkinWeeks.has(w)) missed += 1;
    const lastActive = [m.lastLoginAt, lastCheckin?.createdAt, m.planDays[0]?.completedAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const quietDays = lastActive ? Math.floor((now.getTime() - lastActive.getTime()) / DAY) : null;

    let status = "On track";
    if (!m.active) status = c?.closed ? "Closed" : "Inactive";
    else if (!m.passwordHash) status = "Not registered";
    else if (!c || c.week === 0) status = "Ready";
    else if (quietDays === null || quietDays >= 10) status = "Quiet";
    else if (missed > 0) status = "Behind";

    return { m, c, lastCheckin, missed, lastActive, status };
  });

  const behind = rows.filter((r) => r.status === "Behind" || r.status === "Quiet");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Mentorship</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {selected && clock ? (
              <>
                {selected.label}
                {clock.closed
                  ? ` · Closed${selected.closedAt ? ` ${formatDate(selected.closedAt)}` : ""}`
                  : clock.inProgram
                    ? ` · Week ${clock.week} of ${PROGRAM_WEEKS} · Day ${clock.dayIndex} of ${PROGRAM_DAYS}`
                    : clock.week === 0
                      ? ` · Day 1 is ${formatLongDate(clock.startDate)} (in ${clock.daysToStart} day${clock.daysToStart === 1 ? "" : "s"})`
                      : " · Programme finished"}
                {` · ${activeCount} active mentee${activeCount === 1 ? "" : "s"}`}
              </>
            ) : (
              `All cohorts · ${activeCount} active mentees`
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/mentorship/cohorts"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            Cohorts
          </Link>
          <Link
            href="/dashboard/mentorship/programme"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            Sessions & resources
          </Link>
          <Link
            href={`/dashboard/mentorship/new${selected && !clock?.closed ? `?cohort=${selected.id}` : ""}`}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            Add mentee
          </Link>
        </div>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Cohorts">
        {cohorts.map((c) => {
          const st = derivedStatus(c, now);
          const on = c.id === selectedId;
          return (
            <Link
              key={c.id}
              href={`/dashboard/mentorship?cohort=${c.id}`}
              className={`rounded-full border px-3 py-1.5 transition-colors ${
                on
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
              }`}
            >
              {c.label}
              <span className={`ml-2 text-xs ${on ? "text-zinc-300" : "text-zinc-400"}`}>
                {st} · {sizeByCohort.get(c.id) ?? 0}
              </span>
            </Link>
          );
        })}
        <Link
          href="/dashboard/mentorship?cohort=all"
          className={`rounded-full border px-3 py-1.5 transition-colors ${
            selectedId === "all"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
          }`}
        >
          All
        </Link>
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Check-ins awaiting your reply"
          value={String(pendingCheckins.length)}
          alert={pendingCheckins.length > 0}
          hint={
            pendingCheckins[0]
              ? `Oldest waiting ${Math.max(0, Math.floor((now.getTime() - pendingCheckins[0].createdAt.getTime()) / DAY))} days`
              : "All caught up"
          }
        />
        <StatCard
          label="Unread messages"
          value={String(totalUnread)}
          alert={totalUnread > 0}
          hint={totalUnread > 0 ? "Open the mentee to read" : "Inbox clear"}
        />
        <StatCard
          label="Work to review"
          value={String(reviewTasks + reviewDays)}
          alert={reviewTasks + reviewDays > 0}
          hint={`${reviewTasks} evidence · ${reviewDays} day close-outs`}
        />
        <StatCard
          label="Next session"
          value={nextSession ? formatDateTime(nextSession.scheduledAt).replace(/ WAT$/, "") : "None booked"}
          small
          hint={
            nextSession
              ? `${nextSession.title}${nextSession.mentee ? ` · ${nextSession.mentee.name}` : ""}`
              : "Book one in Sessions & resources"
          }
        />
      </div>

      {pendingCheckins.length > 0 || totalUnread > 0 || behind.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {pendingCheckins.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-sm font-semibold text-amber-900">
                Needs your reply ({pendingCheckins.length})
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {pendingCheckins.map((c) => {
                  const waiting = Math.floor((now.getTime() - c.createdAt.getTime()) / DAY);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={`/dashboard/mentorship/${c.mentee.id}#checkins`}
                        className="underline-offset-2 hover:underline"
                      >
                        {c.mentee.name} · week {c.week}
                      </Link>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          waiting > 2 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {waiting <= 0 ? "today" : `${waiting}d waiting`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="space-y-4">
            {totalUnread > 0 ? (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                <h2 className="text-sm font-semibold text-indigo-900">Unread messages</h2>
                <ul className="mt-2 space-y-1 text-sm text-indigo-800">
                  {unreadCounts.map((u) => {
                    const name =
                      rows.find((r) => r.m.id === u.menteeId)?.m.name ?? "A mentee";
                    return (
                      <li key={u.menteeId}>
                        <Link
                          href={`/dashboard/mentorship/${u.menteeId}#messages`}
                          className="underline-offset-2 hover:underline"
                        >
                          {name} · {u._count._all} new
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {behind.length > 0 ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                <h2 className="text-sm font-semibold text-red-900">Worth a nudge</h2>
                <ul className="mt-2 space-y-1 text-sm text-red-800">
                  {behind.map((r) => (
                    <li key={r.m.id}>
                      <Link
                        href={`/dashboard/mentorship/${r.m.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.m.name}
                      </Link>
                      {" · "}
                      {r.missed > 0 ? `${r.missed} check-in${r.missed === 1 ? "" : "s"} missed · ` : ""}
                      last active {ago(r.lastActive).toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-2 text-xs text-zinc-500">
          <span>
            {mentees.length} mentee{mentees.length === 1 ? "" : "s"}
            {selected ? ` in ${selected.label}` : ""}
          </span>
          {selected?.status !== "closed" ? (
            <Link
              href={`/dashboard/mentorship?cohort=${selectedId}${showInactive ? "" : "&inactive=1"}`}
              className="underline-offset-2 hover:underline"
            >
              {showInactive ? "Hide inactive" : "Show inactive"}
            </Link>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Mentee</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="hidden px-5 py-3 font-semibold lg:table-cell">Track</th>
                <th className="px-5 py-3 font-semibold">Goals</th>
                <th className="hidden px-5 py-3 font-semibold sm:table-cell">Open tasks</th>
                <th className="hidden px-5 py-3 font-semibold md:table-cell">Last check-in</th>
                <th className="hidden px-5 py-3 font-semibold md:table-cell">Last active</th>
                <th className="px-5 py-3 font-semibold">Unread</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-zinc-500">
                    No mentees here yet.{" "}
                    <Link
                      href={`/dashboard/mentorship/new${selected ? `?cohort=${selected.id}` : ""}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      Add a mentee
                    </Link>{" "}
                    or share the join link: abiolaonikoyi.com/mentorship/join
                  </td>
                </tr>
              ) : (
                rows.map(({ m, lastCheckin, lastActive, status }) => {
                  const unread = unreadByMentee.get(m.id) ?? 0;
                  const wa = m.phone?.replace(/[^\d]/g, "");
                  return (
                    <tr
                      key={m.id}
                      className={`transition-colors hover:bg-zinc-50 ${m.active ? "" : "opacity-60"}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {m.photoData ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.photoData}
                              alt=""
                              className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 object-cover"
                            />
                          ) : (
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-400 to-indigo-500 text-xs font-bold text-white">
                              {initials(m.name)}
                            </span>
                          )}
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/mentorship/${m.id}`}
                              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                            >
                              {m.name}
                            </Link>
                            <p className="flex flex-wrap gap-x-2 text-xs text-zinc-500">
                              <a href={`mailto:${m.email}`} className="hover:text-zinc-900">
                                {m.email}
                              </a>
                              {wa ? (
                                <a
                                  href={`https://wa.me/${wa}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-600 hover:text-emerald-800"
                                >
                                  WhatsApp
                                </a>
                              ) : null}
                              {selectedId === "all" ? (
                                <span className="text-zinc-400">
                                  {cohorts.find((c) => c.id === m.cohort)?.label ?? m.cohort}
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? ""}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="hidden max-w-[14rem] truncate px-5 py-3 text-zinc-600 lg:table-cell">
                        {m.track ?? m.focusArea ?? <span className="text-zinc-300">Not set</span>}
                      </td>
                      <td className="px-5 py-3 text-zinc-600">{m._count.goals}</td>
                      <td className="hidden px-5 py-3 text-zinc-600 sm:table-cell">{m._count.tasks}</td>
                      <td className="hidden px-5 py-3 text-zinc-600 md:table-cell">
                        {lastCheckin
                          ? `Week ${lastCheckin.week} · ${formatDate(lastCheckin.createdAt)}`
                          : "None yet"}
                      </td>
                      <td className="hidden px-5 py-3 text-zinc-600 md:table-cell">
                        {ago(lastActive)}
                      </td>
                      <td className="px-5 py-3">
                        {unread > 0 ? (
                          <Link
                            href={`/dashboard/mentorship/${m.id}#messages`}
                            className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700"
                          >
                            {unread}
                          </Link>
                        ) : (
                          <span className="text-zinc-400">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && clock && !clock.closed && clock.week > PROGRAM_WEEKS ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
          This cohort&apos;s 13 weeks finished{" "}
          {daysUntil(clock.endDate, now) < 0 ? `on ${formatLongDate(clock.endDate)}` : ""}. When you are
          done with it,{" "}
          <Link href="/dashboard/mentorship/cohorts" className="font-medium text-zinc-900 underline">
            close the cohort
          </Link>{" "}
          to switch off portal access and clear its open check-ins.
        </p>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  alert,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
  small?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
      <span
        className={`absolute inset-x-0 top-0 h-1 ${
          alert
            ? "bg-gradient-to-r from-amber-400 to-orange-400"
            : "bg-gradient-to-r from-teal-400 to-indigo-400"
        }`}
      />
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`mt-1 font-semibold text-zinc-900 ${small ? "text-base" : "text-2xl"}`}>{value}</p>
      {hint ? <p className="mt-1 truncate text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}
