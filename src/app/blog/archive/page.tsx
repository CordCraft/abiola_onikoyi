import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { getArchivedPosts, POST_KIND_LABELS, type PostKind } from "@/lib/blog";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Writing: Archive",
  description: "Older posts, more than three months old.",
};

export const revalidate = 3600;

export default async function BlogArchivePage() {
  const posts = await getArchivedPosts();

  return (
    <>
      <Nav />
      <main className="flex-1 pt-28">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Link href="/blog" className="text-sm text-zinc-400 hover:text-white">
            ← Back to writing
          </Link>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            Archive
          </h1>
          <p className="mt-3 text-zinc-400">Posts older than three months.</p>

          {posts.length === 0 ? (
            <p className="mt-12 text-zinc-500">Nothing in the archive yet.</p>
          ) : (
            <ul className="mt-12 divide-y divide-white/10 border-y border-white/10">
              {posts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group flex flex-wrap items-baseline justify-between gap-2 py-5 transition-colors hover:bg-white/[0.02]"
                  >
                    <span className="font-medium text-zinc-200 group-hover:text-white">
                      {p.title}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {POST_KIND_LABELS[p.kind as PostKind] ?? p.kind}
                      {p.publishedAt ? ` · ${formatDate(p.publishedAt)}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
