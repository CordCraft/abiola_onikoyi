import type { NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getSession } from "@/lib/session";
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

function guessDeviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);

  const fail = (msg: string, status = 400) => {
    const res = json({ error: msg }, status);
    clearChallengeCookie(res);
    return res;
  };

  if (rateLimited("reg-verify", req)) return fail("Too many attempts", 429);

  const body = (await req.json().catch(() => null)) as {
    response?: RegistrationResponseJSON;
    deviceName?: string;
  } | null;
  if (!body?.response) return fail("Bad request");

  const challenge = await readChallenge(req, "register");
  if (!challenge) return fail("Challenge expired, try again");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: getExpectedOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
    });
  } catch {
    return fail("Could not verify this passkey");
  }
  if (!verification.verified) return fail("Could not verify this passkey");

  const { credential } = verification.registrationInfo;
  await ensureV2Tables();
  const deviceName =
    (body.deviceName ?? "").trim().slice(0, 60) ||
    guessDeviceName(req.headers.get("user-agent") ?? "");
  await prisma.jarvisPasskey.upsert({
    where: { credentialId: credential.id },
    create: {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: (body.response.response.transports ?? []).join(",") || null,
      deviceName,
    },
    update: {},
  });

  const res = json({ verified: true });
  clearChallengeCookie(res);
  return res;
}
