import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { verifySession } from "@/lib/dal";
import { GOOGLE_SCOPES, MICROSOFT_SCOPES, siteOrigin } from "@/lib/jarvis/v2/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the OAuth flow for one more Gmail / Google Calendar or Microsoft 365 account.
// Repeat it for every mailbox; each becomes its own JarvisConnection row.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  await verifySession();
  const { provider } = await params;
  const origin = siteOrigin(req);
  const redirectUri = `${origin}/jarvis/api/connect/${provider}/callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  let url: string;

  if (provider === "google") {
    if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 503 });
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      // Always ask for consent so Google returns a refresh token, and let the owner pick the account.
      prompt: "consent select_account",
      state,
    });
    url = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  } else if (provider === "microsoft") {
    if (!process.env.MS_CLIENT_ID) return NextResponse.json({ error: "MS_CLIENT_ID is not set" }, { status: 503 });
    const p = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MICROSOFT_SCOPES.join(" "),
      prompt: "select_account",
      state,
    });
    url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${p}`;
  } else {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const res = NextResponse.redirect(url);
  res.cookies.set("jarvis_oauth_state", `${provider}:${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/jarvis/api/connect",
  });
  return res;
}
