import Link from "next/link";
import { listVentures } from "@/lib/jarvis/queries";
import { ProjectForm } from "@/components/jarvis/ProjectForm";
import { createProject } from "@/app/jarvis/actions";

export default async function NewProjectPage() {
  const ventures = await listVentures();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/jarvis" className="text-sm text-zinc-500 hover:text-zinc-900">← Back to overview</Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">New project</h1>
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
        <ProjectForm
          action={createProject}
          ventures={ventures.map((v) => ({ id: v.id, name: v.name }))}
          submitLabel="Create project"
        />
      </div>
    </div>
  );
}
