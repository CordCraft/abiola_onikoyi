import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  AdminGoalForm,
  AdminMessageForm,
  AdminTaskForm,
  CheckinReplyForm,
  MenteeForm,
} from "@/components/mentorship/admin-forms";
import { CopyButton } from "@/components/mentorship/CopyButton";
import {
  adminDeleteTask,
  adminSetGoalStatus,
  adminToggleTask,
  regenerateAccessCode,
  setMenteeActive,
} from "@/app/dashboard/mentorship/actions";

export const metadata = { title: "Mentee" };

const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100";

export default async function MenteeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  await ensureMentorshipTables();
  const { id } = await params;

  const mentee = await prisma.mentorshipMentee.findUnique({
    where: { id },
    include: {
      goals: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
      tasks: { orderBy: [{ status: "desc" }, { createdAt: "desc" }] },
      checkins: { orderBy: { week: "desc" } },
      sessions: { orderBy: { scheduledAt: "desc" } },
    },
  });
  if (!mentee) notFound();

  // Opening the thread marks the mentee's messages as read.
  await prisma.mentorshipMessage.updateMany({
    where: { menteeId: mentee.id, sender: "mentee", readAt: null },
    data: { readAt: new Date() },
  });
  const messages = await prisma.mentorshipMessage.findMany({
    where: { menteeId: mentee.id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const inviteText = [
    `Hello ${mentee.name.split(" ")[0]},`,
    "",
    "Here is your access to the mentorship portal:",
    `Portal: https://abiolaonikoyi.com/mentorship/login`,
    `Email: ${mentee.email}`,
    `Access code: ${mentee.accessCode}`,
    "",
    "Sign in, review your goals, and do your first weekly check-in. See you there.",
  ].join("\n");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/mentorship"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            ← Mentorship
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            {mentee.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {mentee.headline ?? "No headline"}
            {mentee.focusArea ? ` · ${mentee.focusArea}` : null}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {mentee.lastLoginAt
              ? `Last signed in ${formatDateTime(mentee.lastLoginAt)}`
              : "Has not signed in yet"}
          </p>
        </div>
        <form action={setMenteeActive}>
          <input type="hidden" name="id" value={mentee.id} />
          <input type="hidden" name="active" value={mentee.active ? "false" : "true"} />
          <button type="submit" className={smallButton}>
            {mentee.active ? "Deactivate access" : "Reactivate access"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Access code</h2>
            <p className="mt-1 font-mono text-lg tracking-widest text-zinc-900">
              {mentee.accessCode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={inviteText} label="Copy invite message" />
            <form action={regenerateAccessCode}>
              <input type="hidden" name="id" value={mentee.id} />
              <button type="submit" className={smallButton}>
                Regenerate
              </button>
            </form>
          </div>
        </div>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-600">
          {inviteText}
        </pre>
      </div>

      <details className="rounded-2xl border border-zinc-200 bg-white p-6">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
          Edit profile
        </summary>
        <div className="mt-4">
          <MenteeForm
            mode="edit"
            defaults={{
              id: mentee.id,
              name: mentee.name,
              email: mentee.email,
              headline: mentee.headline,
              focusArea: mentee.focusArea,
            }}
          />
        </div>
      </details>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Goals</h2>
        {mentee.goals.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No goals yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {mentee.goals.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">
                    {g.title}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        g.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : g.status === "dropped"
                            ? "bg-zinc-200 text-zinc-500"
                            : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {g.status}
                    </span>
                    {g.targetMonth ? (
                      <span className="ml-2 text-xs text-zinc-500">
                        Month {g.targetMonth}
                      </span>
                    ) : null}
                  </p>
                  {g.detail ? (
                    <p className="mt-1 text-sm text-zinc-600">{g.detail}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {g.status !== "completed" ? (
                    <form action={adminSetGoalStatus}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="status" value="completed" />
                      <button type="submit" className={smallButton}>
                        Complete
                      </button>
                    </form>
                  ) : (
                    <form action={adminSetGoalStatus}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="status" value="active" />
                      <button type="submit" className={smallButton}>
                        Reopen
                      </button>
                    </form>
                  )}
                  {g.status !== "dropped" ? (
                    <form action={adminSetGoalStatus}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="status" value="dropped" />
                      <button type="submit" className={smallButton}>
                        Drop
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-zinc-100 pt-5">
          <AdminGoalForm menteeId={mentee.id} />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Tasks</h2>
        {mentee.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No tasks yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100">
            {mentee.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <form action={adminToggleTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    aria-label={t.status === "done" ? "Reopen task" : "Mark done"}
                    className={`grid h-5 w-5 place-items-center rounded-md border transition-colors ${
                      t.status === "done"
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 hover:border-zinc-900"
                    }`}
                  >
                    {t.status === "done" ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      t.status === "done"
                        ? "text-zinc-400 line-through"
                        : "text-zinc-800"
                    }`}
                  >
                    {t.title}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {t.createdBy === "mentee" ? "Added by mentee" : "Assigned by you"}
                    {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : null}
                    {t.notes ? ` · ${t.notes}` : null}
                  </p>
                </div>
                <form action={adminDeleteTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-400 transition-colors hover:text-red-600"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-zinc-100 pt-5">
          <AdminTaskForm
            menteeId={mentee.id}
            goals={mentee.goals
              .filter((g) => g.status === "active")
              .map((g) => ({ id: g.id, title: g.title }))}
          />
        </div>
      </section>

      <section id="checkins" className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Check-ins</h2>
        {mentee.checkins.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No check-ins yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {mentee.checkins.map((c) => (
              <li key={c.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900">
                    Week {c.week}
                    {c.confidence ? (
                      <span className="ml-2 font-normal text-zinc-500">
                        Confidence {c.confidence}/5
                      </span>
                    ) : null}
                  </p>
                  <span className="text-xs text-zinc-400">
                    {formatDate(c.createdAt)}
                  </span>
                </div>
                <dl className="mt-2 space-y-2 text-sm text-zinc-700">
                  <div>
                    <dt className="font-medium text-zinc-500">Wins</dt>
                    <dd className="whitespace-pre-line">{c.wins}</dd>
                  </div>
                  {c.blockers ? (
                    <div>
                      <dt className="font-medium text-zinc-500">Blockers</dt>
                      <dd className="whitespace-pre-line">{c.blockers}</dd>
                    </div>
                  ) : null}
                  {c.nextFocus ? (
                    <div>
                      <dt className="font-medium text-zinc-500">Next focus</dt>
                      <dd className="whitespace-pre-line">{c.nextFocus}</dd>
                    </div>
                  ) : null}
                </dl>
                {c.mentorReply ? (
                  <div className="mt-3 rounded-lg bg-white p-3 text-sm text-zinc-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Your reply · {c.repliedAt ? formatDate(c.repliedAt) : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-line">{c.mentorReply}</p>
                  </div>
                ) : (
                  <CheckinReplyForm checkinId={c.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Messages</h2>
        {messages.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No messages yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {messages.map((m) => {
              const mine = m.sender === "mentor";
              return (
                <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      mine
                        ? "rounded-br-md bg-zinc-900 text-white"
                        : "rounded-bl-md bg-zinc-100 text-zinc-800"
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.body}</p>
                    <p
                      className={`mt-0.5 text-right text-[10px] ${
                        mine ? "text-zinc-400" : "text-zinc-400"
                      }`}
                    >
                      {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <AdminMessageForm menteeId={mentee.id} />
        </div>
      </section>

      {mentee.sessions.length > 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            One-on-one sessions
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-700">
            {mentee.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {s.title} · {formatDateTime(s.scheduledAt)}
                </span>
                <span className="text-xs text-zinc-400">{s.status}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-400">
            Schedule new sessions from{" "}
            <Link
              href="/dashboard/mentorship/programme"
              className="underline-offset-2 hover:underline"
            >
              Sessions & resources
            </Link>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}
