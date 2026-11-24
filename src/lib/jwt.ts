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
    // Device tokens for the iPhone app carry an audience; they are only valid
    // as a Bearer header (see decryptDeviceToken), never as the cookie.
    if (payload.aud !== undefined) return null;
    return {
      user: payload.user,
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    };
  } catch {
    // Invalid/expired/tampered token
    return null;
  }
}

// ── iPhone app device tokens ─────────────────────────────────────────────────
// A paired iPhone app sends `Authorization: Bearer <token>`. The token is a
// long-lived JWT with audience "jarvis-mobile" and the device id in `dev`.
// Revocation (the device must still be listed) is checked in getSession(),
// which can reach the database; the proxy only does this optimistic check.

export const DEVICE_AUDIENCE = "jarvis-mobile";

export type DevicePayload = SessionPayload & { dev: string };

export async function encryptDeviceToken(payload: DevicePayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(DEVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("400d")
    .sign(encodedKey);
}

export async function decryptDeviceToken(
  token: string | undefined | null,
): Promise<DevicePayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
      audience: DEVICE_AUDIENCE,
    });
    if (typeof payload.user !== "string" || typeof payload.dev !== "string") return null;
    return {
      user: payload.user,
      dev: payload.dev,
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    };
  } catch {
    return null;
  }
}

export function bearerFrom(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1].trim() : null;
}
