import { listGoals } from "@/lib/jarvis/queries";
import { GoalForm } from "@/components/jarvis/GoalForm";
import { deleteGoal, addMilestone, toggleMilestone } from "@/app/jarvis/actions";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";
import { formatDate } from "@/lib/format";

export default async function GoalsPage() {
  const goals = await listGoals();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Goals</h1>
        {goals.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">No goals yet. Add one on the right.</p>
        ) : (
          <ul className="mt-6 space-y-4">
            {goals.map((g) => {
              const done = g.milestones.filter((m) => m.done).length;
              return (
                <li key={g.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-zinc-900">{g.title}</h2>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {g.horizon ? `${g.horizon} · ` : ""}
                        {g.targetDate ? `target ${formatDate(g.targetDate)} · ` : ""}
                        {done}/{g.milestones.length} milestones
                      </p>
                      {g.description ? <p className="mt-2 text-sm text-zinc-600">{g.description}</p> : null}
                    </div>
                    <form action={deleteGoal}>
                      <input type="hidden" name="id" value={g.id} />
                      <ConfirmSubmit message={`Delete goal "${g.title}"?`} className="text-xs font-medium text-zinc-400 hover:text-red-600">
                        Delete
                      </ConfirmSubmit>
                    </form>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {g.milestones.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <form action={toggleMilestone}>
                          <input type="hidden" name="id" value={m.id} />
                          <button type="submit" className={`grid h-5 w-5 place-items-center rounded border ${m.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300"}`}>
                            {m.done ? "✓" : ""}
                          </button>
                        </form>
                        <span className={`text-sm ${m.done ? "text-zinc-400 line-through" : "text-zinc-700"}`}>
                          {m.title}
                          {m.dueDate ? <span className="ml-2 text-xs text-zinc-400">{formatDate(m.dueDate)}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <form action={addMilestone} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="goalId" value={g.id} />
                    <input name="title" required placeholder="Add milestone" className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
                    <input name="dueDate" type="date" className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-600" />
                    <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Add</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900">Add goal</h2>
          <GoalForm />
        </div>
      </aside>
    </div>
  );
}
