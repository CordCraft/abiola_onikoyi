"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/session";

export type LoginState = { error?: string } | undefined;

// Best-effort in-memory throttle. On serverless this resets per instance, so it
// is a mild deterrent rather than a guarantee — adequate for a single-user site
// behind HTTPS with a strong password.
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

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const expectedUser = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedUser || !passwordHash) {
    return { error: "Login is not configured. Set the admin environment variables." };
  }

  if (rateLimited(username || "anon")) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  // Always run bcrypt.compare (even when the username is wrong) so response
  // timing doesn't reveal whether the username exists.
  const passwordOk = await bcrypt.compare(password, passwordHash);
  const userOk = username === expectedUser;

  if (!userOk || !passwordOk) {
    return { error: "Invalid username or password." };
  }

  await createSession(expectedUser);
  // redirect() must be called outside any try/catch (it throws internally).
  redirect("/dashboard");
}
