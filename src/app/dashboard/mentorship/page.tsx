import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import {
  COHORT_LABEL,
  PROGRAM_WEEKS,
  programWeek,
} from "@/lib/mentorship/constants";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Mentorship admin" };

export default async function MentorshipAdminPage() {
  await verifySession();
  // First visit after deploy creates the tables in Neon.
  await ensureMentorshipTables();

  const week = programWeek();
  const inProgram = week >= 1 && week <= PROGRAM_WEEKS;

  const [mentees, pendingCheckins, unreadCounts, checkinsThisWeek] =
    await Promise.all([
      prisma.mentorshipMentee.findMany({
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: {
          _count: {
            select: {
              tasks: { where: { status: "todo" } },
              goals: { where: { status: "active" } },
            },
          },
          checkins: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.mentorshipCheckin.findMany({
        where: { mentorReply: null },
        orderBy: { createdAt: "asc" },
        include: { mentee: { select: { id: true, name: true } } },
      }),
      prisma.mentorshipMessage.groupBy({
        by: ["menteeId"],
        where: { sender: "mentee", readAt: null },
        _count: { _all: true },
      }),
      inProgram
        ? prisma.mentorshipCheckin.count({ where: { week } })
        : Promise.resolve(0),
    ]);

  const unreadByMentee = new Map(
    unreadCounts.map((u) => [u.menteeId, u._count._all]),
  );
  const totalUnread = unreadCounts.reduce((sum, u) => sum + u._count._all, 0);
  const activeCount = mentees.filter((m) => m.active).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Mentorship
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {COHORT_LABEL}
            {inProgram ? ` · Week ${week} of ${PROGRAM_WEEKS}` : null}
            {` · ${activeCount} active mentees`}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/dashboard/mentorship/programme"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            Sessions & resources
          </Link>
          <Link
            href="/dashboard/mentorship/new"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            Add mentee
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
          <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-400 to-indigo-400" />
          <p className="text-sm text-zinc-500">Check-ins this week</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">
            {inProgram ? `${checkinsThisWeek} / ${activeCount}` : "n/a"}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
          <span
            className={`absolute inset-x-0 top-0 h-1 ${
              pendingCheckins.length > 0
                ? "bg-gradient-to-r from-amber-400 to-orange-400"
                : "bg-gradient-to-r from-teal-400 to-indigo-400"
            }`}
          />
          <p className="text-sm text-zinc-500">Check-ins awaiting your reply</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">
            {pendingCheckins.length}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
          <span
            className={`absolute inset-x-0 top-0 h-1 ${
              totalUnread > 0
                ? "bg-gradient-to-r from-indigo-400 to-violet-400"
                : "bg-gradient-to-r from-teal-400 to-indigo-400"
            }`}
          />
          <p className="text-sm text-zinc-500">Unread messages</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{totalUnread}</p>
        </div>
      </div>

      {pendingCheckins.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">
            Needs your reply
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {pendingCheckins.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/mentorship/${c.mentee.id}#checkins`}
                  className="underline-offset-2 hover:underline"
                >
                  {c.mentee.name} · week {c.week} check-in ·{" "}
                  {formatDate(c.createdAt)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Mentee</th>
              <th className="hidden px-5 py-3 font-semibold sm:table-cell">Focus</th>
              <th className="px-5 py-3 font-semibold">Goals</th>
              <th className="px-5 py-3 font-semibold">Open tasks</th>
              <th className="hidden px-5 py-3 font-semibold md:table-cell">
                Last check-in
              </th>
              <th className="px-5 py-3 font-semibold">Unread</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {mentees.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                  No mentees yet.{" "}
                  <Link
                    href="/dashboard/mentorship/new"
                    className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                  >
                    Add your first mentee
                  </Link>{" "}
                  to generate their access code.
                </td>
              </tr>
            ) : (
              mentees.map((m) => {
                const unread = unreadByMentee.get(m.id) ?? 0;
                const lastCheckin = m.checkins[0];
                return (
                  <tr
                    key={m.id}
                    className={`transition-colors hover:bg-zinc-50 ${m.active ? "" : "opacity-50"}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-400 to-indigo-500 text-xs font-bold text-white">
                          {m.name
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p) => p[0]?.toUpperCase())
                            .join("")}
                        </span>
                        <div>
                          <Link
                            href={`/dashboard/mentorship/${m.id}`}
                            className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                          >
                            {m.name}
                          </Link>
                          {!m.active ? (
                            <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                              inactive
                            </span>
                          ) : null}
                          <p className="text-xs text-zinc-500">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 text-zinc-600 sm:table-cell">
                      {m.focusArea ?? "·"}
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{m._count.goals}</td>
                    <td className="px-5 py-3 text-zinc-600">{m._count.tasks}</td>
                    <td className="hidden px-5 py-3 text-zinc-600 md:table-cell">
                      {lastCheckin
                        ? `Week ${lastCheckin.week} · ${formatDate(lastCheckin.createdAt)}`
                        : "None yet"}
                    </td>
                    <td className="px-5 py-3">
                      {unread > 0 ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {unread}
                        </span>
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
  );
}
