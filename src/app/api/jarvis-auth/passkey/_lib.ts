import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

// Shared helpers for the passkey (Face ID) routes. Lives beside the routes but
// is not itself routable (only route.ts files are).

export const CHALLENGE_COOKIE = "passkey_challenge";
const CHALLENGE_TTL_SECONDS = 5 * 60;
const COOKIE_PATH = "/api/jarvis-auth/passkey";

export type ChallengePurpose = "register" | "login";

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

function hostOf(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.nextUrl.host
  )
    .split(",")[0]
    .trim();
}

export function getRpId(req: NextRequest): string {
  const fromEnv = process.env.PASSKEY_RP_ID?.trim();
  if (fromEnv) return fromEnv;
  const hostname = hostOf(req).replace(/:\d+$/, "").toLowerCase();
  return hostname.replace(/^www\./, "");
}

export function getExpectedOrigin(req: NextRequest): string {
  const host = hostOf(req);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = isLocal
    ? (req.headers.get("x-forwarded-proto") ??
      req.nextUrl.protocol.replace(":", ""))
    : "https";
  return `${proto}://${host}`;
}

export async function setChallengeCookie(
  res: NextResponse,
  challenge: string,
  purpose: ChallengePurpose,
): Promise<void> {
  const token = await new SignJWT({ challenge, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(key());
  res.cookies.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CHALLENGE_TTL_SECONDS,
    path: COOKIE_PATH,
  });
}

// Reads and validates the challenge cookie. Callers must also call
// clearChallengeCookie on the response so the challenge is single use.
export async function readChallenge(
  req: NextRequest,
  purpose: ChallengePurpose,
): Promise<string | null> {
  const token = req.cookies.get(CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose) return null;
    return typeof payload.challenge === "string" ? payload.challenge : null;
  } catch {
    return null;
  }
}

export function clearChallengeCookie(res: NextResponse): void {
  res.cookies.set(CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: COOKIE_PATH,
  });
}

// Best-effort in-memory throttle (same approach as login/actions.ts).
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;

export function rateLimited(bucket: string, req: NextRequest, max = 30): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0].trim();
  const k = `${bucket}:${ip}`;
  const now = Date.now();
  const rec = attempts.get(k);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(k, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
