import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { ProjectForm } from "@/components/dashboard/ProjectForm";
import { createProject } from "@/app/dashboard/actions";

export default async function NewProjectPage() {
  await verifySession();

  return (
    <div>
      <Link
        href="/dashboard"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← Back to projects
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">
        New project
      </h1>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8">
        <ProjectForm action={createProject} submitLabel="Create project" />
      </div>
    </div>
  );
}
