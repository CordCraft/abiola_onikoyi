"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createMenteeSession } from "@/lib/mentorship/session";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { generateAccessCode } from "@/lib/mentorship/codes";
import { draftInitialGoals } from "@/lib/mentorship/goal-draft";
import { ensureBlueprint, ensureWeekGenerated } from "@/lib/mentorship/program-gen";
import {
  parseProfileFields,
  validatePhotoData,
} from "@/lib/mentorship/profile";

export type SignupState = { error?: string } | undefined;

// In-memory throttle: signups are rare, so a low ceiling per instance is fine.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

// One-shot signup for new mentees. If the mentor pre-registered the email
// (a mentee row without a password), the signup claims that row; otherwise a
// new mentee is created. Accounts that already have a password must sign in
// instead. After saving, three draft goals are generated from the story so
// the portal opens personal, not empty.
export async function signUp(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!name) return { error: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email does not look valid." };
  }
  if (password.length < 8) {
    return { error: "Choose a password of at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match." };
  }
  if (rateLimited(email)) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const photoData = validatePhotoData(String(formData.get("photoData") ?? ""));
  if (!photoData) {
    return { error: "Please add a photo. It helps your mentor and cohort know you." };
  }

  const fields = parseProfileFields(formData);
  if (!fields.expectations) {
    return { error: "Tell your mentor what you want from the programme." };
  }

  await ensureMentorshipTables();

  const existing = await prisma.mentorshipMentee.findUnique({
    where: { email },
  });
  if (existing?.passwordHash) {
    return {
      error:
        "This email already has an account. Switch to the sign in tab instead. Forgot your password? Ask your mentor to reset it, then register again.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const data = {
    name,
    ...fields,
    photoData,
    passwordHash,
    onboardedAt: new Date(),
    lastLoginAt: new Date(),
  };

  const mentee = existing
    ? await prisma.mentorshipMentee.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.mentorshipMentee.create({
        data: { email, accessCode: generateAccessCode(), ...data },
      });

  // Personalized starter goals, then the 91-day programme blueprint and the
  // first week of daily tasks, all drafted from their story (never throws).
  // Runs after the response is sent so signup stays fast and can never hit
  // the serverless time cap waiting on the model; everything appears on the
  // portal moments later, and the programme page can regenerate any missing
  // piece itself if this background window gets cut short.
  after(async () => {
    await draftInitialGoals(mentee.id);
    await ensureBlueprint(mentee.id);
    await ensureWeekGenerated(mentee.id, 1).catch(() => {});
  });

  await createMenteeSession(mentee.id, mentee.name);
  revalidatePath("/dashboard/mentorship");

  // redirect() must be called outside any try/catch (it throws internally).
  redirect("/mentorship/portal");
}
