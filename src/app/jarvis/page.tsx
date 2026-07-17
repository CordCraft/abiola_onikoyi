import Link from "next/link";
import {
  getOverview,
  listUnfiledDocuments,
  listInboxNotes,
  latestBriefing,
  isStalled,
  isPast,
  daysSince,
} from "@/lib/jarvis/queries";
import { formatDate } from "@/lib/format";
import { projectHealth, healthTone } from "@/lib/jarvis/health";
import { PushToggle } from "@/components/jarvis/PushToggle";
import { CaptureBox } from "@/components/jarvis/CaptureBox";
import { SpeakButton } from "@/components/jarvis/SpeakButton";
import { BadgeUpdater } from "@/components/jarvis/BadgeUpdater";
import { briefingFeedback, deleteNote } from "@/app/jarvis/actions";

const toneColors: Record<string, string> = {
  good: "stroke-emerald-500",
  warn: "stroke-amber-500",
  bad: "stroke-red-500",
};

function HealthRing({ score }: { score: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid h-9 w-9 shrink-0 place-items-center" title={`Health ${score}/100`}>
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className="stroke-zinc-200/80" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          className={toneColors[healthTone(score)]}
        />
      </svg>
      <span className="absolute text-[9px] font-bold text-zinc-600">{score}</span>
    </span>
  );
}

const priorityBadge: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-1 ring-red-200",
  medium: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  low: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200",
};

const cardBase =
  "rounded-2xl border border-white/60 bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur-sm";

function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <h2 className={`text-xs font-semibold uppercase tracking-[0.12em] ${accent ?? "text-zinc-500"}`}>
      {children}
    </h2>
  );
}

export default async function JarvisOverview({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;
  const [{ projects, tasks, goals }, unfiledDocs, inbox, briefing] = await Promise.all([
    getOverview(),
    listUnfiledDocuments(),
    listInboxNotes(),
    latestBriefing(),
  ]);
  const stalled = projects.filter((p) => isStalled(p));
  const active = projects.filter((p) => !isStalled(p));

  const overdueCount = tasks.filter((t) => isPast(t.dueDate)).length;

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-zinc-900 via-zinc-900 to-indigo-950 p-8 text-white shadow-[0_20px_50px_-20px_rgba(30,27,75,0.5)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-indigo-300">Second brain</p>
            <h1 className="mt-1.5 text-3xl font-bold tracking-tight">Overview</h1>
            <p className="mt-2 max-w-md text-sm text-zinc-300">
              Your ventures at a glance. Ask Jarvis to capture documents, log decisions, and move things forward.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/jarvis/chat"
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              Open chat
            </Link>
            <Link
              href="/jarvis/projects/new"
              className="rounded-xl border border-white/25 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
            >
              + Project
            </Link>
            <PushToggle />
          </div>
        </div>

        {/* Stat strip */}
        <div className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Active", value: active.length, tone: "text-emerald-300" },
            { label: "Stalled", value: stalled.length, tone: stalled.length ? "text-red-300" : "text-zinc-400" },
            { label: "Overdue", value: overdueCount, tone: overdueCount ? "text-amber-300" : "text-zinc-400" },
            { label: "Goals", value: goals.length, tone: "text-indigo-300" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
              <div className={`text-2xl font-bold ${s.tone}`}>{s.value}</div>
              <div className="text-xs uppercase tracking-wide text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <BadgeUpdater count={inbox.length} />

      {/* Quick capture */}
      <CaptureBox autoFocus={focus === "capture"} />

      {/* Morning briefing */}
      {briefing ? (
        <section className={`${cardBase} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <SectionLabel accent="text-indigo-600">Today&apos;s briefing</SectionLabel>
            <div className="flex items-center gap-1">
              <SpeakButton text={briefing.body.replace(/^Morning briefing:\s*/, "")} />
              <form action={briefingFeedback}>
                <input type="hidden" name="vote" value="up" />
                <button type="submit" title="More like this" className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-emerald-50 hover:text-emerald-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V2.75a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904" />
                  </svg>
                </button>
              </form>
              <form action={briefingFeedback}>
                <input type="hidden" name="vote" value="down" />
                <button type="submit" title="Less like this" className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600">
                  <svg className="h-4 w-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V2.75a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904" />
                  </svg>
                </button>
              </form>
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
            {briefing.body.replace(/^Morning briefing:\s*/, "")}
          </p>
        </section>
      ) : null}

      {/* Inbox */}
      {inbox.length > 0 ? (
        <section>
          <SectionLabel accent="text-indigo-600">Inbox ({inbox.length})</SectionLabel>
          <p className="mt-1 text-xs text-zinc-500">
            Quick captures waiting to be filed.{" "}
            <Link
              href="/jarvis/chat?inbox=1"
              className="font-medium text-indigo-600 underline-offset-2 hover:underline"
            >
              Ask Jarvis to file them
            </Link>
            .
          </p>
          <ul className={`mt-3 divide-y divide-zinc-100 overflow-hidden ${cardBase}`}>
            {inbox.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate text-sm text-zinc-800">{n.body}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-zinc-400">{daysSince(n.createdAt)}d</span>
                  <form action={deleteNote}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" aria-label="Delete capture" className="text-xs text-zinc-300 hover:text-red-600">
                      ×
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stalled.length > 0 ? (
        <section>
          <SectionLabel accent="text-red-600">Stalled ({stalled.length})</SectionLabel>
          <ul className="mt-3 space-y-3">
            {stalled.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/jarvis/projects/${p.id}`}
                  className="block rounded-2xl border border-red-200/70 bg-red-50/60 p-4 backdrop-blur-sm transition-colors hover:bg-red-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-zinc-900">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                      idle {daysSince(p.lastActivityAt)}d
                    </span>
                  </div>
                  {p.venture ? <p className="mt-0.5 text-xs text-zinc-500">{p.venture.name}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionLabel>Active projects</SectionLabel>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No active projects.{" "}
            <Link href="/jarvis/projects/new" className="font-medium text-indigo-600 underline-offset-2 hover:underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {active.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/jarvis/projects/${p.id}`}
                  className={`group block ${cardBase} p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_1px_3px_rgba(0,0,0,0.04),0_18px_40px_-16px_rgba(30,27,75,0.28)]`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <HealthRing score={projectHealth(p)} />
                      <span className="truncate font-semibold text-zinc-900 transition-colors group-hover:text-indigo-700">
                        {p.name}
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadge[p.priority] ?? priorityBadge.low}`}>
                      {p.priority}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {p.venture ? `${p.venture.name} · ` : ""}
                    {p._count.tasks} tasks · updated {daysSince(p.lastActivityAt)}d ago
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionLabel>Upcoming &amp; overdue tasks</SectionLabel>
        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No dated tasks.</p>
        ) : (
          <ul className={`mt-3 divide-y divide-zinc-100 overflow-hidden ${cardBase}`}>
            {tasks.map((t) => {
              const overdue = isPast(t.dueDate);
              return (
                <li key={t.id} className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50/70">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-zinc-300"}`} />
                    <span className="truncate text-sm font-medium text-zinc-900">{t.title}</span>
                    {t.project ? <span className="truncate text-xs text-zinc-400">{t.project.name}</span> : null}
                  </div>
                  {t.dueDate ? (
                    <span className={`shrink-0 text-xs font-medium ${overdue ? "text-red-600" : "text-zinc-500"}`}>
                      {overdue ? "overdue " : "due "}
                      {formatDate(t.dueDate)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {unfiledDocs.length > 0 ? (
        <section>
          <SectionLabel accent="text-amber-600">Unfiled documents ({unfiledDocs.length})</SectionLabel>
          <p className="mt-1 text-xs text-zinc-500">
            Captured from chat but not attached to a project yet. Ask Jarvis to file them.
          </p>
          <ul className={`mt-3 divide-y divide-zinc-100 overflow-hidden ${cardBase}`}>
            {unfiledDocs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/jarvis/documents/${doc.id}`} className="block truncate text-sm font-medium text-zinc-900 hover:text-indigo-700">
                    {doc.name}
                  </Link>
                  {doc.summary ? (
                    <p className="truncate text-xs text-zinc-500">{doc.summary}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-zinc-400">{formatDate(doc.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>Goals</SectionLabel>
          <Link href="/jarvis/goals" className="text-xs font-medium text-zinc-500 transition-colors hover:text-indigo-600">
            Manage →
          </Link>
        </div>
        {goals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No goals yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {goals.map((g) => {
              const done = g.milestones.filter((m) => m.done).length;
              const pct = g.milestones.length ? Math.round((done / g.milestones.length) * 100) : 0;
              return (
                <li key={g.id} className={`${cardBase} p-4`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-zinc-900">{g.title}</span>
                    <span className="text-xs font-medium text-zinc-500">
                      {done}/{g.milestones.length}
                    </span>
                  </div>
                  {g.milestones.length ? (
                    <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
