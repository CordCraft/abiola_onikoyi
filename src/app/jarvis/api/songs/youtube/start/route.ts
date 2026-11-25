import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { verifySession } from "@/lib/dal";
import { siteOrigin } from "@/lib/jarvis/v2/connections";
import { YOUTUBE_SCOPE } from "@/lib/jarvis/songs/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connects the Novale YouTube channel for the "Novale Likes" playlist. Uses
// the site's Google OAuth client; its redirect list needs
// <site>/jarvis/api/songs/youtube/callback and the project needs the
// YouTube Data API v3 enabled (docs/JARVIS-SONGS.md).
export async function GET(req: Request) {
  await verifySession();
  if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 503 });
  const origin = siteOrigin(req);
  const state = crypto.randomBytes(24).toString("base64url");
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/jarvis/api/songs/youtube/callback`,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    // consent: always return a refresh token; select_account: lets you pick
    // the Novale brand channel when Google shows the channel chooser.
    prompt: "consent select_account",
    state,
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  res.cookies.set("jarvis_yt_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/jarvis/api/songs/youtube",
  });
  return res;
}
