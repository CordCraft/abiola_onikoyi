"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { uniquePostSlug } from "@/lib/blog";
import {
  POST_CATEGORIES,
  POST_KINDS,
  type PostCategory,
  type PostKind,
} from "@/lib/blog-constants";
import { generateWeeklyPost } from "@/lib/generate-post";

export type FormResult = { error?: string; ok?: boolean } | undefined;

function revalidateBlog(slug?: string) {
  revalidatePath("/");
  revalidatePath("/blog");
  revalidatePath("/blog/archive");
  revalidatePath("/dashboard/blog");
  if (slug) revalidatePath(`/blog/${slug}`);
}

function parseCategory(v: FormDataEntryValue | null): PostCategory {
  const s = String(v ?? "");
  return (POST_CATEGORIES as readonly string[]).includes(s)
    ? (s as PostCategory)
    : POST_CATEGORIES[0];
}

function parseKind(v: FormDataEntryValue | null): PostKind {
  const s = String(v ?? "");
  return (POST_KINDS as readonly string[]).includes(s) ? (s as PostKind) : "insight";
}

export async function createPost(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const title = String(formData.get("title") ?? "").trim();
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = parseCategory(formData.get("category"));
  const kind = parseKind(formData.get("kind"));
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const sourceName = String(formData.get("sourceName") ?? "").trim() || null;
  const published = formData.get("published") === "on";

  if (!title) return { error: "Title is required." };
  if (!body) return { error: "Body is required." };

  const slug = await uniquePostSlug(title);
  const post = await prisma.post.create({
    data: {
      slug,
      title,
      excerpt,
      body,
      category,
      kind,
      sourceUrl,
      sourceName,
      published,
      publishedAt: published ? new Date() : null,
    },
  });

  revalidateBlog(slug);
  redirect(`/dashboard/blog/${post.id}`);
}

export async function updatePost(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing post id." };

  const existing = await prisma.post.findUnique({ where: { id } });
  if (!existing) return { error: "Post not found." };

  const title = String(formData.get("title") ?? "").trim();
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = parseCategory(formData.get("category"));
  const kind = parseKind(formData.get("kind"));
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const sourceName = String(formData.get("sourceName") ?? "").trim() || null;
  const published = formData.get("published") === "on";

  if (!title) return { error: "Title is required." };
  if (!body) return { error: "Body is required." };

  const slug = await uniquePostSlug(title, id);
  await prisma.post.update({
    where: { id },
    data: {
      slug,
      title,
      excerpt,
      body,
      category,
      kind,
      sourceUrl,
      sourceName,
      published,
      // Stamp the publish date the first time it goes live.
      publishedAt:
        published && !existing.publishedAt ? new Date() : existing.publishedAt,
    },
  });

  revalidateBlog(slug);
  return { ok: true };
}

export async function deletePost(formData: FormData) {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.post.delete({ where: { id } });
  revalidateBlog();
  redirect("/dashboard/blog");
}

export async function togglePublish(formData: FormData) {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  const post = await prisma.post.findUnique({ where: { id } });
  if (post) {
    const nowPublished = !post.published;
    await prisma.post.update({
      where: { id },
      data: {
        published: nowPublished,
        publishedAt:
          nowPublished && !post.publishedAt ? new Date() : post.publishedAt,
      },
    });
    revalidateBlog(post.slug);
  }
}

// Generate one draft on demand (also the weekly job's logic). Used by a button.
export async function generateNow(
  _prev: FormResult,
  _formData: FormData,
): Promise<FormResult> {
  await verifySession();
  let postId: string;
  try {
    const post = await generateWeeklyPost();
    postId = post.id;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Generation failed.",
    };
  }
  revalidateBlog();
  redirect(`/dashboard/blog/${postId}`);
}
