"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createMenteeSession } from "@/lib/mentorship/session";
import { normalizeAccessCode } from "@/lib/mentorship/codes";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";

export type MenteeLoginState = { error?: string } | undefined;

// Best-effort in-memory throttle, same trade-off as the admin login: resets
// per serverless instance, adequate for a six-person cohort behind HTTPS.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 10;

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

export async function menteeLogin(
  _prev: MenteeLoginState,
  formData: FormData,
): Promise<MenteeLoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const code = normalizeAccessCode(String(formData.get("code") ?? ""));

  if (!email || !code) {
    return { error: "Enter both your email and your access code." };
  }
  if (rateLimited(email)) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  await ensureMentorshipTables();

  const mentee = await prisma.mentorshipMentee.findUnique({ where: { email } });

  if (!mentee || !mentee.active || mentee.accessCode !== code) {
    return {
      error:
        "That email and access code combination was not recognized. Codes look like ABCD-EFGH; ask your mentor if you have misplaced yours.",
    };
  }

  await prisma.mentorshipMentee.update({
    where: { id: mentee.id },
    data: { lastLoginAt: new Date() },
  });
  await createMenteeSession(mentee.id, mentee.name);

  // redirect() must be called outside any try/catch (it throws internally).
  redirect("/mentorship/portal");
}
