import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Markdown } from "@/components/Markdown";
import { getPublishedPostBySlug, POST_KIND_LABELS, type PostKind } from "@/lib/blog";
import { formatDate } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(slug);
  if (!post) return { title: "Not found" };
  return { title: post.title, description: post.excerpt || undefined };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(slug);
  if (!post) notFound();

  return (
    <>
      <Nav />
      <main className="flex-1 pt-28">
        <article className="mx-auto max-w-2xl px-6 py-16">
          <Link href="/blog" className="text-sm text-zinc-400 hover:text-white">
            ← Back to writing
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">
              {POST_KIND_LABELS[post.kind as PostKind] ?? post.kind}
            </span>
            <span className="text-zinc-500">{post.category}</span>
            {post.publishedAt ? (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-500">{formatDate(post.publishedAt)}</span>
              </>
            ) : null}
          </div>

          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            {post.title}
          </h1>
          {post.excerpt ? (
            <p className="mt-3 text-lg text-zinc-400">{post.excerpt}</p>
          ) : null}

          <div className="mt-8 border-t border-white/10 pt-8 text-[1.05rem]">
            <Markdown tone="dark">{post.body}</Markdown>
          </div>

          {post.sourceUrl ? (
            <p className="mt-10 border-t border-white/10 pt-6 text-sm text-zinc-500">
              Source:{" "}
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent hover:underline"
              >
                {post.sourceName || post.sourceUrl} ↗
              </a>
            </p>
          ) : null}
        </article>
      </main>
      <Footer />
    </>
  );
}
