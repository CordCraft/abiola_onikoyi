import { SignJWT, jwtVerify } from "jose";

// Mentee session JWT, kept separate from the admin session (different cookie,
// different payload shape) so a mentee token can never unlock admin areas.
// No Next.js or cookie dependencies: safe to import from the proxy.

export type MenteeSessionPayload = {
  menteeId: string;
  name: string;
  expiresAt: string; // ISO timestamp
};

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function encryptMenteeSession(
  payload: MenteeSessionPayload,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(encodedKey);
}

export async function decryptMenteeSession(
  token: string | undefined,
): Promise<MenteeSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    // Reject admin tokens (payload.user) and anything without a menteeId.
    if (typeof payload.menteeId !== "string" || typeof payload.user === "string") {
      return null;
    }
    return {
      menteeId: payload.menteeId,
      name: typeof payload.name === "string" ? payload.name : "",
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    };
  } catch {
    // Invalid, expired or tampered token
    return null;
  }
}
