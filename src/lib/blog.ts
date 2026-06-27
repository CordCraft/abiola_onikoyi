import "server-only";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { ARCHIVE_AFTER_DAYS, postSlugify } from "@/lib/blog-constants";

export * from "@/lib/blog-constants";

function archiveCutoff(): Date {
  return new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

// --- Public reads (published only) ---
export async function getRecentPosts() {
  return prisma.post.findMany({
    where: { published: true, publishedAt: { gte: archiveCutoff() } },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getArchivedPosts() {
  return prisma.post.findMany({
    where: { published: true, publishedAt: { lt: archiveCutoff() } },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getLatestPosts(take = 3) {
  return prisma.post.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    take,
  });
}

export async function getPublishedPostBySlug(slug: string) {
  return prisma.post.findFirst({ where: { slug, published: true } });
}

// --- Admin reads (session-gated) ---
export async function getAllPosts() {
  await verifySession();
  return prisma.post.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function getPostById(id: string) {
  await verifySession();
  return prisma.post.findUnique({ where: { id } });
}

// Build a slug unique among posts (server-side helper shared by admin + generator).
export async function uniquePostSlug(
  title: string,
  excludeId?: string,
): Promise<string> {
  const root = postSlugify(title) || "post";
  let slug = root;
  let i = 1;
  for (;;) {
    const existing = await prisma.post.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    i += 1;
    slug = `${root}-${i}`;
  }
}
