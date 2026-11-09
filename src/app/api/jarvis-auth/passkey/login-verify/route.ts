import type { NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import {
  clearChallengeCookie,
  getExpectedOrigin,
  getRpId,
  json,
  rateLimited,
  readChallenge,
} from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const fail = (msg: string, status = 400) => {
    const res = json({ error: msg }, status);
    clearChallengeCookie(res);
    return res;
  };

  if (rateLimited("login-verify", req, 20)) return fail("Too many attempts", 429);

  const adminUser = process.env.ADMIN_USERNAME;
  if (!adminUser) return fail("Login is not configured", 500);

  const body = (await req.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;
  if (!body?.response?.id) return fail("Bad request");

  const challenge = await readChallenge(req, "login");
  if (!challenge) return fail("Challenge expired, try again");

  await ensureV2Tables();
  const stored = await prisma.jarvisPasskey.findUnique({
    where: { credentialId: body.response.id },
  });
  if (!stored) return fail("Unknown passkey", 401);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: getExpectedOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports ? stored.transports.split(",") : undefined,
      },
    });
  } catch {
    return fail("Passkey check failed", 401);
  }
  if (!verification.verified) return fail("Passkey check failed", 401);

  await prisma.jarvisPasskey.update({
    where: { credentialId: stored.credentialId },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  await createSession(adminUser);
  const res = json({ verified: true });
  clearChallengeCookie(res);
  return res;
}
