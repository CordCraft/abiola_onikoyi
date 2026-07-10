import Link from "next/link";
import { listVentures } from "@/lib/jarvis/queries";
import { VentureForm } from "@/components/jarvis/VentureForm";
import { deleteVenture } from "@/app/jarvis/actions";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";

export default async function VenturesPage() {
  const ventures = await listVentures();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Ventures</h1>
          <Link href="/jarvis/projects/new" className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            + Project
          </Link>
        </div>
        {ventures.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">No ventures yet. Add one on the right.</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {ventures.map((v) => (
              <li key={v.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold text-zinc-900">{v.name}</span>
                    <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{v.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400">{v._count.projects} projects</span>
                    <form action={deleteVenture}>
                      <input type="hidden" name="id" value={v.id} />
                      <ConfirmSubmit message={`Delete venture "${v.name}"? Its projects are kept but unlinked.`} className="text-xs font-medium text-zinc-400 hover:text-red-600">
                        Delete
                      </ConfirmSubmit>
                    </form>
                  </div>
                </div>
                {v.description ? <p className="mt-1 text-sm text-zinc-500">{v.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900">Add venture</h2>
          <VentureForm />
        </div>
      </aside>
    </div>
  );
}
