"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createMenteeSession } from "@/lib/mentorship/session";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";

export type MenteeLoginState = { error?: string } | undefined;

// Best-effort in-memory throttle, same trade-off as the admin login: resets
// per serverless instance, adequate for a small cohort behind HTTPS.
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

// Everyday sign-in: email + password. First-time mentees register at
// /mentorship/join. Recovery: the mentor resets the password from the admin
// area, after which the mentee registers again (profile is preserved).
export async function menteeLogin(
  _prev: MenteeLoginState,
  formData: FormData,
): Promise<MenteeLoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both your email and your password." };
  }
  if (rateLimited(email)) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  await ensureMentorshipTables();
  const mentee = await prisma.mentorshipMentee.findUnique({ where: { email } });

  if (!mentee || !mentee.active) {
    return { error: "That email and password combination was not recognized." };
  }
  if (!mentee.passwordHash) {
    return {
      error:
        "This account has no password yet. Use the Join page to finish your registration.",
    };
  }
  const ok = await bcrypt.compare(password, mentee.passwordHash);
  if (!ok) {
    return { error: "That email and password combination was not recognized." };
  }

  await prisma.mentorshipMentee.update({
    where: { id: mentee.id },
    data: { lastLoginAt: new Date() },
  });
  await createMenteeSession(mentee.id, mentee.name);

  // redirect() must be called outside any try/catch (it throws internally).
  redirect("/mentorship/portal");
}
