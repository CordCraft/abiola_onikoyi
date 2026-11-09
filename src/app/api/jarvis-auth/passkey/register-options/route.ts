import type { NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { getRpId, json, rateLimited, setChallengeCookie } from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  if (rateLimited("reg-options", req)) {
    return json({ error: "Too many attempts" }, 429);
  }

  await ensureV2Tables();
  const existing = await prisma.jarvisPasskey.findMany({
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: "Jarvis",
    rpID: getRpId(req),
    userName: session.user,
    userDisplayName: "Abiola",
    userID: new TextEncoder().encode(session.user),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? p.transports.split(",") : undefined,
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
  });

  const res = json(options);
  await setChallengeCookie(res, options.challenge, "register");
  return res;
}
