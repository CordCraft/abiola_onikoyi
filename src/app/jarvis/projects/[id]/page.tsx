import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, listVentures, PRIORITIES } from "@/lib/jarvis/queries";
import { ProjectForm } from "@/components/jarvis/ProjectForm";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";
import { formatDate } from "@/lib/format";
import {
  updateProject,
  deleteProject,
  createTask,
  cycleTask,
  deleteTask,
  createNote,
  createDecision,
} from "@/app/jarvis/actions";

const statusBadge: Record<string, string> = {
  todo: "bg-zinc-200 text-zinc-600",
  doing: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, ventures] = await Promise.all([getProject(id), listVentures()]);
  if (!project) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/jarvis" className="text-sm text-zinc-500 hover:text-zinc-900">← Overview</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{project.name}</h1>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{project.status}</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{project.priority}</span>
          {project.venture ? <span className="text-xs text-zinc-400">{project.venture.name}</span> : null}
        </div>
        {project.summary ? <p className="mt-2 text-zinc-600">{project.summary}</p> : null}
      </div>

      {/* Tasks */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Tasks</h2>
        <ul className="mt-3 space-y-2">
          {project.tasks.length === 0 ? <li className="text-sm text-zinc-500">No tasks yet.</li> : null}
          {project.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 px-3 py-2">
              <div className="flex items-center gap-3">
                <form action={cycleTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[t.status] ?? statusBadge.todo}`}>
                    {t.status}
                  </button>
                </form>
                <span className={`text-sm ${t.status === "done" ? "text-zinc-400 line-through" : "text-zinc-800"}`}>{t.title}</span>
              </div>
              <div className="flex items-center gap-3">
                {t.dueDate ? <span className="text-xs text-zinc-400">{formatDate(t.dueDate)}</span> : null}
                <form action={deleteTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <ConfirmSubmit message="Delete task?" className="text-xs text-zinc-400 hover:text-red-600">×</ConfirmSubmit>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <form action={createTask} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="title" required placeholder="New task" className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
          <select name="priority" defaultValue="medium" className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-600">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input name="dueDate" type="date" className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-600" />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700">Add</button>
        </form>
      </section>

      {/* Notes */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Notes</h2>
        <form action={createNote} className="mt-3 space-y-2">
          <input type="hidden" name="projectId" value={project.id} />
          <textarea name="body" rows={2} required placeholder="Add a note…" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Add note</button>
        </form>
        <ul className="mt-4 space-y-3">
          {project.notes.map((n) => (
            <li key={n.id} className="border-l-2 border-zinc-200 pl-3">
              <p className="whitespace-pre-wrap text-sm text-zinc-700">{n.body}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{formatDate(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Decisions */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Decisions</h2>
        <p className="text-sm text-zinc-500">Log a decision and the reasoning, so Jarvis can recall the “why” later.</p>
        <form action={createDecision} className="mt-3 space-y-2">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="title" required placeholder="Decision" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
          <textarea name="rationale" rows={2} required placeholder="Why?" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Log decision</button>
        </form>
        <ul className="mt-4 space-y-3">
          {project.decisions.map((d) => (
            <li key={d.id} className="border-l-2 border-indigo-200 pl-3">
              <p className="text-sm font-medium text-zinc-900">{d.title}</p>
              <p className="text-sm text-zinc-600">{d.rationale}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{formatDate(d.createdAt)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Edit */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">Edit project</h2>
        <ProjectForm
          action={updateProject}
          ventures={ventures.map((v) => ({ id: v.id, name: v.name }))}
          project={{
            id: project.id,
            name: project.name,
            ventureId: project.ventureId,
            status: project.status,
            priority: project.priority,
            summary: project.summary,
          }}
          submitLabel="Save changes"
        />
      </section>

      <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Delete project</h2>
        <p className="mb-4 mt-1 text-sm text-red-700">Removes the project and its tasks, notes, and decisions.</p>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <ConfirmSubmit message="Delete this project and everything under it?" className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">
            Delete project
          </ConfirmSubmit>
        </form>
      </section>
    </div>
  );
}
