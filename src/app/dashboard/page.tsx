import Link from "next/link";
import {
  getProjects,
  STATUS_LABELS,
  STATUS_STYLES,
  type Status,
} from "@/lib/projects";
import { formatDate } from "@/lib/format";

export default async function DashboardPage() {
  const projects = await getProjects();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Your projects
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track your ventures and post progress updates.
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          + New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <p className="text-zinc-600">No projects yet.</p>
          <Link
            href="/dashboard/projects/new"
            className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {projects.map((p) => {
            const status = (p.status as Status) ?? "building";
            const latest = p.updates[0];
            return (
              <li key={p.id}>
                <Link
                  href={`/dashboard/projects/${p.id}`}
                  className="block rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-900">
                        {p.title}
                      </h2>
                      {p.summary ? (
                        <p className="mt-1 text-sm text-zinc-600">{p.summary}</p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        STATUS_STYLES[status] ?? STATUS_STYLES.building
                      }`}
                    >
                      {STATUS_LABELS[status] ?? "Building"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-xs text-zinc-500">
                    <span>
                      {p._count.updates}{" "}
                      {p._count.updates === 1 ? "update" : "updates"}
                    </span>
                    {latest ? (
                      <>
                        <span className="text-zinc-300">·</span>
                        <span>
                          Latest: {latest.title} ({formatDate(latest.createdAt)})
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-zinc-300">·</span>
                        <span>No updates yet</span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
