import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject,
  STATUS_LABELS,
  STATUS_STYLES,
  type Status,
} from "@/lib/projects";
import {
  updateProject,
  deleteProject,
  deleteUpdate,
} from "@/app/dashboard/actions";
import { ProjectForm } from "@/components/dashboard/ProjectForm";
import { UpdateForm } from "@/components/dashboard/UpdateForm";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";
import { Markdown } from "@/components/Markdown";
import { formatDate } from "@/lib/format";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const status = (project.status as Status) ?? "building";

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Back to projects
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {project.title}
          </h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              STATUS_STYLES[status] ?? STATUS_STYLES.building
            }`}
          >
            {STATUS_LABELS[status] ?? "Building"}
          </span>
        </div>
        {project.summary ? (
          <p className="mt-2 text-zinc-600">{project.summary}</p>
        ) : null}
        {project.link ? (
          <a
            href={project.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
          >
            {project.link} ↗
          </a>
        ) : null}
      </div>

      {/* Post an update */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Post an update</h2>
        <p className="mb-4 mt-1 text-sm text-zinc-500">
          Log progress, milestones, or notes.
        </p>
        <UpdateForm projectId={project.id} />
      </section>

      {/* Updates timeline */}
      <section>
        <h2 className="text-lg font-semibold text-zinc-900">
          Progress updates ({project.updates.length})
        </h2>
        {project.updates.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No updates yet. Post the first one above.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {project.updates.map((u) => (
              <li
                key={u.id}
                className="rounded-2xl border border-zinc-200 bg-white p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-zinc-900">{u.title}</h3>
                    <p className="text-xs text-zinc-400">
                      {formatDate(u.createdAt)}
                    </p>
                  </div>
                  <form action={deleteUpdate}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="projectId" value={project.id} />
                    <ConfirmSubmit
                      message="Delete this update?"
                      className="text-xs font-medium text-zinc-400 hover:text-red-600"
                    >
                      Delete
                    </ConfirmSubmit>
                  </form>
                </div>
                <div className="mt-3 text-sm">
                  <Markdown>{u.body}</Markdown>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Edit project */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">
          Edit project
        </h2>
        <ProjectForm
          action={updateProject}
          submitLabel="Save changes"
          project={{
            id: project.id,
            title: project.title,
            summary: project.summary,
            status: project.status,
            link: project.link,
          }}
        />
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Delete project</h2>
        <p className="mb-4 mt-1 text-sm text-red-700">
          Permanently removes this project and all of its updates.
        </p>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <ConfirmSubmit
            message="Delete this project and all its updates? This cannot be undone."
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
          >
            Delete project
          </ConfirmSubmit>
        </form>
      </section>
    </div>
  );
}
