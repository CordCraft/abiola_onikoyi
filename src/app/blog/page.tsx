import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { getRecentPosts, POST_KIND_LABELS, type PostKind } from "@/lib/blog";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Writing",
  description: "Industry news and insights on petroleum engineering and the energy transition.",
};

// Refresh hourly so posts move into the archive once they pass 3 months.
// Publishing/editing also revalidates these paths immediately.
export const revalidate = 3600;

export default async function BlogIndexPage() {
  const posts = await getRecentPosts();

  return (
    <>
      <Nav />
      <main className="flex-1 pt-28">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
            Writing
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
            Notes & industry news
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-400">
            Current developments and my own perspective on reservoir management,
            operations, and innovation in energy.
          </p>

          {posts.length === 0 ? (
            <p className="mt-12 text-zinc-500">No posts published yet. Check back soon.</p>
          ) : (
            <ul className="mt-12 divide-y divide-white/10 border-y border-white/10">
              {posts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group flex gap-5 py-7 transition-colors hover:bg-white/[0.02]"
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.imageAlt || p.title}
                        className="hidden h-24 w-36 shrink-0 rounded-lg border border-white/10 object-cover sm:block"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">
                          {POST_KIND_LABELS[p.kind as PostKind] ?? p.kind}
                        </span>
                        <span className="text-zinc-500">{p.category}</span>
                        {p.publishedAt ? (
                          <>
                            <span className="text-zinc-600">·</span>
                            <span className="text-zinc-500">
                              {formatDate(p.publishedAt)}
                            </span>
                          </>
                        ) : null}
                      </div>
                      <h2 className="mt-2 text-xl font-semibold text-zinc-100 group-hover:text-white">
                        {p.title}
                      </h2>
                      {p.excerpt ? (
                        <p className="mt-1 text-zinc-400">{p.excerpt}</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-10">
            <Link
              href="/blog/archive"
              className="text-sm font-medium text-zinc-400 hover:text-white"
            >
              View archive (older than 3 months) →
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
