import type { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRpId, json, rateLimited, setChallengeCookie } from "../_lib";

export const dynamic = "force-dynamic";

// Public: no session needed. Discoverable credentials, so no allowCredentials
// list (iOS shows the Face ID sheet without asking for a username, and nothing
// is leaked about which credentials exist).
export async function POST(req: NextRequest) {
  if (rateLimited("login-options", req, 60)) {
    return json({ error: "Too many attempts" }, 429);
  }
  const options = await generateAuthenticationOptions({
    rpID: getRpId(req),
    userVerification: "required",
  });
  const res = json(options);
  await setChallengeCookie(res, options.challenge, "login");
  return res;
}
