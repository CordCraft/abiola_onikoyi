import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { GOOGLE_SCOPES, MICROSOFT_SCOPES, saveConnection, siteOrigin } from "@/lib/jarvis/v2/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
      upn?: string;
    };
    return (payload.email || payload.preferred_username || payload.upn || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  await verifySession();
  const { provider } = await params;
  const origin = siteOrigin(req);
  const back = (msg: string) => NextResponse.redirect(`${origin}/jarvis/connect?${msg}`);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("jarvis_oauth_state")?.value;
  jar.delete({ name: "jarvis_oauth_state", path: "/jarvis/api/connect" });

  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") || url.searchParams.get("error") || "denied")}`);
  if (!code || !state || expected !== `${provider}:${state}`) return back("error=state_mismatch");

  const redirectUri = `${origin}/jarvis/api/connect/${provider}/callback`;
  const isGoogle = provider === "google";
  const body = new URLSearchParams({
    client_id: (isGoogle ? process.env.GOOGLE_CLIENT_ID : process.env.MS_CLIENT_ID) || "",
    client_secret: (isGoogle ? process.env.GOOGLE_CLIENT_SECRET : process.env.MS_CLIENT_SECRET) || "",
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!isGoogle) body.set("scope", MICROSOFT_SCOPES.join(" "));
  const tokenUrl = isGoogle ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const res = await fetch(tokenUrl, { method: "POST", body });
  const tok = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !tok.access_token) {
    return back(`error=${encodeURIComponent(tok.error_description || tok.error || `token exchange ${res.status}`)}`);
  }

  let account = emailFromIdToken(tok.id_token);
  if (!account) {
    const me = await fetch(isGoogle ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
      .then((r) => r.json())
      .catch(() => ({}));
    account = String(me.emailAddress || me.mail || me.userPrincipalName || "").toLowerCase() || null;
  }
  if (!account) return back("error=could_not_read_account");

  await saveConnection({
    provider: isGoogle ? "google" : "microsoft",
    account,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? null,
    expiresIn: tok.expires_in,
    scopes: tok.scope || (isGoogle ? GOOGLE_SCOPES : MICROSOFT_SCOPES).join(" "),
  });
  return back(`connected=${encodeURIComponent(account)}`);
}
