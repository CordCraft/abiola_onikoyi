"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { deleteSession } from "@/lib/session";
import { STATUSES, slugify, type Status } from "@/lib/project-constants";

export type FormResult = { error?: string; ok?: boolean } | undefined;

function parseStatus(value: FormDataEntryValue | null): Status {
  const s = String(value ?? "");
  return (STATUSES as readonly string[]).includes(s) ? (s as Status) : "building";
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base || "project";
  let slug = root;
  let i = 1;
  // Loop until we find a slug not used by a different project.
  for (;;) {
    const existing = await prisma.project.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    i += 1;
    slug = `${root}-${i}`;
  }
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

export async function createProject(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();

  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const status = parseStatus(formData.get("status"));
  const link = String(formData.get("link") ?? "").trim() || null;

  if (!title) return { error: "Title is required." };

  const slug = await uniqueSlug(slugify(title));
  const project = await prisma.project.create({
    data: { title, summary, status, link, slug },
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard/projects/${project.id}`);
}

export async function updateProject(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const status = parseStatus(formData.get("status"));
  const link = String(formData.get("link") ?? "").trim() || null;

  if (!id) return { error: "Missing project id." };
  if (!title) return { error: "Title is required." };

  const slug = await uniqueSlug(slugify(title), id);
  await prisma.project.update({
    where: { id },
    data: { title, summary, status, link, slug },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${id}`);
  return { ok: true };
}

export async function deleteProject(formData: FormData) {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.project.delete({ where: { id } });
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function createUpdate(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();

  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!projectId) return { error: "Missing project id." };
  if (!title) return { error: "Update title is required." };
  if (!body) return { error: "Update body is required." };

  await prisma.update.create({ data: { projectId, title, body } });
  // Touch the project so it sorts to the top of the dashboard.
  await prisma.project.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

export async function deleteUpdate(formData: FormData) {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (id) {
    await prisma.update.delete({ where: { id } });
  }
  revalidatePath("/dashboard");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}
