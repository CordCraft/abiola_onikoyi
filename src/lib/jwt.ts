import { SignJWT, jwtVerify } from "jose";

// Pure JWT sign/verify with no Next.js or cookie dependencies, so this module
// is safe to import from both the proxy and server components.

export type SessionPayload = {
  user: string;
  expiresAt: string; // ISO timestamp
};

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decryptSession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    if (typeof payload.user !== "string") return null;
    return {
      user: payload.user,
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    };
  } catch {
    // Invalid/expired/tampered token
    return null;
  }
}
