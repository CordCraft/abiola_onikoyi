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
  adminRevokeAiTool,
  adminSetGoalStatus,
  adminToggleTask,
  deleteMentee,
  resetMenteePassword,
  setMenteeActive,
} from "@/app/dashboard/mentorship/actions";
import {
  GrantToolForm,
  PlanDayCommentForm,
  PlanTaskCommentForm,
} from "@/components/mentorship/admin-plan-forms";
import { computeStreak } from "@/lib/mentorship/plan";
import { PLAN_KIND_LABELS, planDayIndex, type PlanTaskKind } from "@/lib/mentorship/constants";

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
      planDays: {
        orderBy: { dayIndex: "asc" },
        include: { tasks: { orderBy: { order: "asc" } } },
      },
      aiTools: { orderBy: { tool: "asc" } },
    },
  });
  if (!mentee) notFound();

  const todayIndex = planDayIndex();
  const planTasks = mentee.planDays.flatMap((d) => d.tasks);
  const planDone = planTasks.filter((t) => t.status === "done");
  const planStreak = computeStreak(mentee.planDays, todayIndex);
  const planWeeks = Array.from(
    new Set(mentee.planDays.map((d) => d.week)),
  ).sort((a, b) => a - b);
  const currentWeek = Math.min(Math.max(1, Math.ceil(Math.max(1, todayIndex) / 7)), 13);

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
    "Welcome to the mentorship programme. Register here:",
    `https://abiolaonikoyi.com/mentorship/join`,
    `Use this email: ${mentee.email}`,
    "",
    "You will choose your own password, upload a photo (have a nice headshot ready), and share your story. The portal drafts your starter goals from it, and we refine them together. See you inside.",
  ].join("\n");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {mentee.photoData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mentee.photoData}
              alt={mentee.name}
              className="mt-1 h-20 w-20 rounded-2xl border border-zinc-200 object-cover shadow-sm"
            />
          ) : null}
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
            {" · "}
            {mentee.onboardedAt
              ? `Onboarded ${formatDate(mentee.onboardedAt)}`
              : "Not onboarded yet"}
          </p>
          </div>
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
            <h2 className="text-sm font-semibold text-zinc-900">
              Invite & account
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {mentee.passwordHash
                ? "Registered with a password."
                : "Not registered yet. Share the invite below."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={inviteText} label="Copy invite message" />
            {mentee.passwordHash ? (
              <form action={resetMenteePassword}>
                <input type="hidden" name="id" value={mentee.id} />
                <button type="submit" className={smallButton}>
                  Reset password
                </button>
              </form>
            ) : null}
          </div>
        </div>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-600">
          {inviteText}
        </pre>
        {mentee.passwordHash ? (
          <p className="mt-2 text-xs text-zinc-400">
            Reset password clears their password so they can register again at
            the Join page with the same email. Profile, goals, and history are
            kept.
          </p>
        ) : null}
      </div>

      {mentee.onboardedAt ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900">Mentee dossier</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Self-reported at onboarding. Use it to shape goals and open doors.
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            {(
              [
                ["Phone / WhatsApp", mentee.phone],
                [
                  "LinkedIn",
                  mentee.linkedin ? (
                    <a
                      key="li"
                      href={mentee.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 underline-offset-2 hover:underline"
                    >
                      {mentee.linkedin.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null,
                ],
                ["Level", mentee.level],
                ["Expected graduation", mentee.gradYear],
                ["Interests", mentee.interests],
                ["Skills and tools", mentee.skills],
                ["Dream roles", mentee.dreamRoles],
                ["Availability", mentee.availability],
                [
                  "Preferred channel",
                  mentee.commsPref === "whatsapp"
                    ? "WhatsApp"
                    : mentee.commsPref === "email"
                      ? "Email"
                      : mentee.commsPref === "portal"
                        ? "Portal messages"
                        : mentee.commsPref === "call"
                          ? "Phone call"
                          : null,
                ],
              ] as [string, React.ReactNode][]
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium text-zinc-500">{k}</dt>
                  <dd className="mt-0.5 text-zinc-800">{v}</dd>
                </div>
              ))}
          </dl>
          {(
            [
              ["Their story", mentee.backgroundStory],
              ["2-year vision", mentee.aspirations],
              ["5-year vision", mentee.longTermVision],
              ["Wants from the mentorship", mentee.expectations],
              ["Biggest challenge", mentee.challenges],
            ] as [string, string | null][]
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {k}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-700">{v}</p>
              </div>
            ))}
        </section>
      ) : (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          This mentee has not completed onboarding yet. Once they activate with
          their access code, their full profile (photo, contact, aspirations,
          expectations) appears here.
        </p>
      )}

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

      {mentee.planDays.length > 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">
              Daily programme
            </h2>
            <p className="text-sm text-zinc-500">
              {planDone.length}/{planTasks.length} tasks ·{" "}
              {planDone.reduce((s, t) => s + t.points, 0)} pts
              {planStreak > 0 ? ` · 🔥 ${planStreak}-day streak` : ""}
              {todayIndex >= 1 && todayIndex <= 91
                ? ` · Day ${todayIndex}, week ${currentWeek}`
                : todayIndex === 0
                  ? " · starts 1 Aug"
                  : " · wrapped"}
            </p>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Review evidence and leave comments; mentees see them on the day.
            Weeks unlock for the mentee when they submit the previous
            week&apos;s check-in, whether or not you have replied.
          </p>
          <div className="mt-4 space-y-2">
            {planWeeks.map((w) => {
              const days = mentee.planDays.filter((d) => d.week === w);
              const wTasks = days.flatMap((d) => d.tasks);
              const wDone = wTasks.filter((t) => t.status === "done").length;
              return (
                <details
                  key={w}
                  open={w === currentWeek && todayIndex >= 1 && todayIndex <= 91}
                  className="rounded-xl border border-zinc-100 bg-zinc-50"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-sm font-medium text-zinc-800">
                    <span>Week {w}</span>
                    <span className="text-xs text-zinc-400">
                      {wDone}/{wTasks.length} tasks
                    </span>
                  </summary>
                  <div className="space-y-3 px-3 pb-3">
                    {days.map((day) => (
                      <div
                        key={day.id}
                        className="rounded-lg border border-zinc-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-zinc-900">
                            Day {day.dayIndex}: {day.title}
                            {day.completedAt ? (
                              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                closed out
                                {day.confidence ? ` · ${day.confidence}/5` : ""}
                              </span>
                            ) : null}
                          </p>
                          <span className="text-xs text-zinc-400">
                            {formatDate(day.date)}
                          </span>
                        </div>
                        <ul className="mt-2 space-y-1.5">
                          {day.tasks.map((t) => (
                            <li key={t.id} className="text-xs text-zinc-600">
                              <span
                                className={`mr-1 inline-block w-3 text-center ${
                                  t.status === "done"
                                    ? "text-emerald-600"
                                    : "text-zinc-300"
                                }`}
                              >
                                {t.status === "done" ? "✓" : "○"}
                              </span>
                              <span className="font-medium text-zinc-700">
                                [{PLAN_KIND_LABELS[t.kind as PlanTaskKind] ?? t.kind}]
                              </span>{" "}
                              {t.title}
                              {t.evidence ? (
                                <div className="ml-4 mt-1 rounded-md bg-zinc-50 p-2">
                                  <p className="whitespace-pre-line break-words text-xs text-zinc-600">
                                    {t.evidence}
                                  </p>
                                  {t.mentorComment ? (
                                    <p className="mt-1 border-t border-zinc-200 pt-1 text-xs text-indigo-700">
                                      You: {t.mentorComment}
                                    </p>
                                  ) : (
                                    <PlanTaskCommentForm taskId={t.id} />
                                  )}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        {day.reflection ? (
                          <p className="mt-2 rounded-md bg-zinc-50 p-2 text-xs italic text-zinc-600">
                            “{day.reflection}”
                          </p>
                        ) : null}
                        {day.mentorComment ? (
                          <p className="mt-2 text-xs text-indigo-700">
                            You: {day.mentorComment}
                          </p>
                        ) : day.completedAt ? (
                          <div className="mt-2">
                            <PlanDayCommentForm dayId={day.id} />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">AI toolkit</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Provision API keys the mentee sees in their portal. Grant when their
          plan calls for it; revoke any time.
        </p>
        <div className="mt-4 space-y-3">
          {(["anthropic", "openai", "fal"] as const).map((tool) => {
            const row = mentee.aiTools.find((t) => t.tool === tool);
            const label =
              tool === "anthropic"
                ? "Claude API"
                : tool === "openai"
                  ? "OpenAI API"
                  : "fal.ai";
            return (
              <div
                key={tool}
                className="rounded-xl border border-zinc-100 bg-zinc-50 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900">
                    {label}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row?.status === "granted"
                          ? "bg-emerald-100 text-emerald-700"
                          : row?.status === "requested"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-zinc-200 text-zinc-500"
                      }`}
                    >
                      {row?.status ?? "available"}
                    </span>
                  </p>
                  {row?.status === "granted" ? (
                    <form action={adminRevokeAiTool}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className={smallButton}>
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </div>
                {row?.note ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Mentee&apos;s note: {row.note}
                  </p>
                ) : null}
                {row?.status === "granted" && row.apiKey ? (
                  <p className="mt-2 truncate font-mono text-xs text-zinc-500">
                    {row.apiKey.slice(0, 14)}…{row.apiKey.slice(-4)}
                  </p>
                ) : (
                  <div className="mt-3">
                    <GrantToolForm menteeId={mentee.id} tool={tool} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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

      <details className="rounded-2xl border border-red-200 bg-red-50/50 p-6">
        <summary className="cursor-pointer text-sm font-semibold text-red-800">
          Danger zone
        </summary>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-700">
            Permanently delete this mentee and all of their goals, tasks,
            check-ins, and messages. Use deactivate instead for real mentees.
          </p>
          <form action={deleteMentee}>
            <input type="hidden" name="id" value={mentee.id} />
            <button
              type="submit"
              className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Delete mentee permanently
            </button>
          </form>
        </div>
      </details>

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
