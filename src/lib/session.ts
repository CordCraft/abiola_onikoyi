import "server-only";
import { cookies } from "next/headers";
import { encryptSession, decryptSession, type SessionPayload } from "@/lib/jwt";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(user: string): Promise<void> {
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);
  const token = await encryptSession({
    user,
    expiresAt: expiresAt.toISOString(),
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return decryptSession(token);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
