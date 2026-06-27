import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostById } from "@/lib/blog";
import { PostForm } from "@/components/dashboard/PostForm";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";
import { updatePost, deletePost } from "@/app/dashboard/blog/actions";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) notFound();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard/blog" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Back to blog
        </Link>
        {post.published ? (
          <Link
            href={`/blog/${post.slug}`}
            target="_blank"
            className="text-sm font-medium text-accent hover:underline"
          >
            View live ↗
          </Link>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8">
        <PostForm
          action={updatePost}
          submitLabel="Save changes"
          post={{
            id: post.id,
            title: post.title,
            excerpt: post.excerpt,
            body: post.body,
            category: post.category,
            kind: post.kind,
            sourceUrl: post.sourceUrl,
            sourceName: post.sourceName,
            published: post.published,
          }}
        />
      </div>

      <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Delete post</h2>
        <p className="mb-4 mt-1 text-sm text-red-700">
          Permanently removes this post.
        </p>
        <form action={deletePost}>
          <input type="hidden" name="id" value={post.id} />
          <ConfirmSubmit
            message="Delete this post? This cannot be undone."
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
          >
            Delete post
          </ConfirmSubmit>
        </form>
      </section>
    </div>
  );
}
