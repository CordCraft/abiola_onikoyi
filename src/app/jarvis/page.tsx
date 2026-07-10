import Link from "next/link";
import { getOverview, isStalled, isPast, daysSince } from "@/lib/jarvis/queries";
import { formatDate } from "@/lib/format";

const priorityBadge: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-zinc-200 text-zinc-600",
};

export default async function JarvisOverview() {
  const { projects, tasks, goals } = await getOverview();
  const stalled = projects.filter((p) => isStalled(p));
  const active = projects.filter((p) => !isStalled(p));

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Your ventures at a glance. Ask Jarvis to move things forward.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/jarvis/chat" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700">
            Open chat
          </Link>
          <Link href="/jarvis/projects/new" className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            + Project
          </Link>
        </div>
      </div>

      {stalled.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">
            Stalled ({stalled.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {stalled.map((p) => (
              <li key={p.id}>
                <Link href={`/jarvis/projects/${p.id}`} className="block rounded-xl border border-red-200 bg-red-50/50 p-4 hover:bg-red-50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-zinc-900">{p.name}</span>
                    <span className="text-xs text-red-600">no activity in {daysSince(p.lastActivityAt)} days</span>
                  </div>
                  {p.venture ? <p className="mt-0.5 text-xs text-zinc-500">{p.venture.name}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Active projects</h2>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No active projects. <Link href="/jarvis/projects/new" className="text-zinc-900 underline">Create one</Link>.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {active.map((p) => (
              <li key={p.id}>
                <Link href={`/jarvis/projects/${p.id}`} className="block rounded-xl border border-zinc-200 bg-white p-4 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-zinc-900">{p.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadge[p.priority] ?? priorityBadge.low}`}>
                      {p.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {p.venture ? `${p.venture.name} · ` : ""}{p._count.tasks} tasks · updated {daysSince(p.lastActivityAt)}d ago
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Upcoming & overdue tasks</h2>
        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No dated tasks.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tasks.map((t) => {
              const overdue = isPast(t.dueDate);
              return (
                <li key={t.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-900">{t.title}</span>
                    {t.project ? <span className="ml-2 text-xs text-zinc-400">{t.project.name}</span> : null}
                  </div>
                  {t.dueDate ? (
                    <span className={`shrink-0 text-xs font-medium ${overdue ? "text-red-600" : "text-zinc-500"}`}>
                      {overdue ? "overdue " : "due "}{formatDate(t.dueDate)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Goals</h2>
          <Link href="/jarvis/goals" className="text-xs font-medium text-zinc-500 hover:text-zinc-900">Manage →</Link>
        </div>
        {goals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No goals yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {goals.map((g) => {
              const done = g.milestones.filter((m) => m.done).length;
              const pct = g.milestones.length ? Math.round((done / g.milestones.length) * 100) : 0;
              return (
                <li key={g.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-zinc-900">{g.title}</span>
                    <span className="text-xs text-zinc-500">{done}/{g.milestones.length}</span>
                  </div>
                  {g.milestones.length ? (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-100">
                      <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
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
