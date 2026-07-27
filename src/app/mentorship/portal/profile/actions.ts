"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import {
  parseProfileFields,
  validatePhotoData,
} from "@/lib/mentorship/profile";

export type ProfileFormResult = { error?: string; ok?: boolean } | undefined;

export async function updateProfile(
  _prev: ProfileFormResult,
  formData: FormData,
): Promise<ProfileFormResult> {
  const mentee = await verifyMentee();

  const fields = parseProfileFields(formData);
  const photoData = validatePhotoData(String(formData.get("photoData") ?? ""));

  await prisma.mentorshipMentee.update({
    where: { id: mentee.id },
    data: { ...fields, ...(photoData ? { photoData } : {}) },
  });

  revalidatePath("/mentorship/portal/profile");
  revalidatePath("/mentorship/portal");
  revalidatePath(`/dashboard/mentorship/${mentee.id}`);
  return { ok: true };
}

export async function changePassword(
  _prev: ProfileFormResult,
  formData: FormData,
): Promise<ProfileFormResult> {
  const mentee = await verifyMentee();

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) {
    return { error: "The new password needs at least 8 characters." };
  }
  if (next !== confirm) {
    return { error: "The two new passwords do not match." };
  }
  if (mentee.passwordHash) {
    const ok = await bcrypt.compare(current, mentee.passwordHash);
    if (!ok) return { error: "Your current password is not right." };
  }

  await prisma.mentorshipMentee.update({
    where: { id: mentee.id },
    data: { passwordHash: await bcrypt.hash(next, 10) },
  });

  return { ok: true };
}
