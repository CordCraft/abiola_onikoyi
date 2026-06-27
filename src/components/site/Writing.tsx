import Link from "next/link";
import { Reveal } from "@/components/anim/Reveal";
import { formatDate } from "@/lib/format";
import { getLatestPosts, POST_KIND_LABELS, type PostKind } from "@/lib/blog";

// Latest published posts teaser on the home page. Fails closed (renders nothing)
// if there are no posts or the database is unavailable, so the home page never
// breaks on it.
export async function Writing() {
  let posts: Awaited<ReturnType<typeof getLatestPosts>> = [];
  try {
    posts = await getLatestPosts(3);
  } catch {
    posts = [];
  }
  if (posts.length === 0) return null;

  return (
    <section
      id="writing"
      className="relative border-t hairline bg-background/45 py-28 backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <div className="mb-12 flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
                Writing
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Latest notes
              </h2>
            </div>
            <Link
              href="/blog"
              className="hidden text-sm font-medium text-zinc-400 hover:text-white sm:block"
            >
              All writing →
            </Link>
          </div>
        </Reveal>

        <Reveal className="grid gap-6 md:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/blog/${p.slug}`}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.imageAlt || p.title}
                  className="mb-4 h-32 w-full rounded-lg border border-white/10 object-cover"
                />
              ) : null}
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                  {POST_KIND_LABELS[p.kind as PostKind] ?? p.kind}
                </span>
                {p.publishedAt ? (
                  <span className="text-zinc-500">{formatDate(p.publishedAt)}</span>
                ) : null}
              </div>
              <h3 className="mt-3 font-semibold text-zinc-100 group-hover:text-white">
                {p.title}
              </h3>
              {p.excerpt ? (
                <p className="mt-2 line-clamp-3 text-sm text-zinc-400">
                  {p.excerpt}
                </p>
              ) : null}
            </Link>
          ))}
        </Reveal>

        <Link
          href="/blog"
          className="mt-8 inline-block text-sm font-medium text-zinc-400 hover:text-white sm:hidden"
        >
          All writing →
        </Link>
      </div>
    </section>
  );
}
