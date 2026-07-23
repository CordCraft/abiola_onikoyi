import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { setGoalStatus, toggleTask } from "@/app/mentorship/portal/actions";
import { GoalForm, TaskForm } from "@/components/mentorship/forms";
import { Card, CardTitle, EmptyState, Pill } from "@/components/mentorship/ui";
import { formatDate } from "@/lib/format";
import type { MentorshipTask } from "@prisma/client";

function TaskRow({ task }: { task: MentorshipTask }) {
  const done = task.status === "done";
  return (
    <li className="flex items-start gap-3 py-2">
      <form action={toggleTask}>
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className={`mt-0.5 grid h-5 w-5 place-items-center rounded-md border transition-colors ${
            done
              ? "border-accent bg-accent text-zinc-950"
              : "border-white/25 hover:border-accent"
          }`}
        >
          {done ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {task.createdBy === "mentor" ? <Pill tone="accent">From mentor</Pill> : null}
          {task.dueDate ? <span>Due {formatDate(task.dueDate)}</span> : null}
          {task.notes ? <span className="text-zinc-500">{task.notes}</span> : null}
        </div>
      </div>
    </li>
  );
}

export default async function GoalsPage() {
  const mentee = await verifyMentee();

  const [goals, tasks] = await Promise.all([
    prisma.mentorshipGoal.findMany({
      where: { menteeId: mentee.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    prisma.mentorshipTask.findMany({
      where: { menteeId: mentee.id },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const visibleGoals = goals.filter((g) => g.status !== "dropped");
  const generalTasks = tasks.filter((t) => !t.goalId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Goals & Tasks
        </h1>
        <p className="mt-1 text-zinc-400">
          Three strong goals beat ten vague ones. Tasks are the weekly steps that
          get you there.
        </p>
      </div>

      {visibleGoals.length === 0 ? (
        <EmptyState>
          No goals yet. Propose your first goal below; your mentor will refine it
          with you in your one-on-one.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {visibleGoals.map((goal) => {
            const goalTasks = tasks.filter((t) => t.goalId === goal.id);
            const doneCount = goalTasks.filter((t) => t.status === "done").length;
            const completed = goal.status === "completed";
            return (
              <Card key={goal.id} className={completed ? "opacity-75" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{goal.title}</h2>
                      {completed ? (
                        <Pill tone="green">Completed</Pill>
                      ) : goal.targetMonth ? (
                        <Pill tone="neutral">Month {goal.targetMonth}</Pill>
                      ) : null}
                    </div>
                    {goal.detail ? (
                      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                        {goal.detail}
                      </p>
                    ) : null}
                  </div>
                  <form action={setGoalStatus}>
                    <input type="hidden" name="id" value={goal.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={completed ? "active" : "completed"}
                    />
                    <button
                      type="submit"
                      className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
                    >
                      {completed ? "Reopen" : "Mark completed"}
                    </button>
                  </form>
                </div>
                {goalTasks.length > 0 ? (
                  <>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Tasks · {doneCount}/{goalTasks.length} done
                    </p>
                    <ul className="mt-1 divide-y divide-white/5">
                      {goalTasks.map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardTitle kicker="New goal" title="Propose a goal" />
        <GoalForm />
      </Card>

      <Card>
        <CardTitle
          kicker="General tasks"
          title="Tasks not tied to a goal"
        />
        {generalTasks.length > 0 ? (
          <ul className="mb-4 divide-y divide-white/5">
            {generalTasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-zinc-500">Nothing here yet.</p>
        )}
        <TaskForm
          goals={visibleGoals
            .filter((g) => g.status === "active")
            .map((g) => ({ id: g.id, title: g.title }))}
        />
      </Card>
    </div>
  );
}
