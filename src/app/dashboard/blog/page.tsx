import Link from "next/link";
import { getAllPosts, POST_KIND_LABELS, type PostKind } from "@/lib/blog";
import { formatDate } from "@/lib/format";
import { GenerateButton } from "@/components/dashboard/GenerateButton";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";
import { togglePublish, deletePost } from "./actions";

export default async function BlogAdminPage() {
  const posts = await getAllPosts();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Blog
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            New posts are generated weekly as drafts. Review, edit, and publish.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <GenerateButton />
          <Link
            href="/dashboard/blog/new"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            + New post
          </Link>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center text-zinc-600">
          No posts yet. Generate a draft or write one.
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {posts.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/blog/${p.id}`}
                    className="font-semibold text-zinc-900 hover:underline"
                  >
                    {p.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        p.published
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {p.published ? "Published" : "Draft"}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                      {POST_KIND_LABELS[p.kind as PostKind] ?? p.kind}
                    </span>
                    <span>{p.category}</span>
                    <span className="text-zinc-300">·</span>
                    <span>
                      {p.publishedAt
                        ? `Published ${formatDate(p.publishedAt)}`
                        : `Created ${formatDate(p.createdAt)}`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={togglePublish}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      {p.published ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                  <Link
                    href={`/dashboard/blog/${p.id}`}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    Edit
                  </Link>
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      message="Delete this post?"
                      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-400 hover:text-red-600"
                    >
                      Delete
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
