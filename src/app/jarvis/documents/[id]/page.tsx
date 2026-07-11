import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { deleteDocument } from "@/app/jarvis/actions";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const doc = await prisma.jarvisDocument
    .findUnique({ where: { id }, include: { project: { select: { id: true, name: true } } } })
    .catch(() => null);
  if (!doc) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={doc.project ? `/jarvis/projects/${doc.project.id}` : "/jarvis"}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {doc.project ? doc.project.name : "Overview"}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900">
            <svg className="h-6 w-6 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="truncate">{doc.name}</span>
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Captured {formatDate(doc.createdAt)}
          {doc.project ? (
            <>
              {" · filed under "}
              <Link href={`/jarvis/projects/${doc.project.id}`} className="text-indigo-600 hover:underline">
                {doc.project.name}
              </Link>
            </>
          ) : (
            " · unfiled"
          )}
          {" · "}
          {doc.content.length.toLocaleString()} characters
        </p>
        {doc.summary ? (
          <p className="mt-3 rounded-xl bg-indigo-50/70 px-4 py-3 text-sm text-indigo-900">{doc.summary}</p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Link
            href={`/jarvis/chat?doc=${doc.id}`}
            className="rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
          >
            Discuss in chat
          </Link>
          <form action={deleteDocument}>
            <input type="hidden" name="id" value={doc.id} />
            <ConfirmSubmit
              message="Delete this document from the library?"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-red-300 hover:text-red-700"
            >
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Extracted text</h2>
        <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-800">
          {doc.content}
        </pre>
      </section>
    </div>
  );
}
