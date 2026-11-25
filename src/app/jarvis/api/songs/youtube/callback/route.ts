import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { siteOrigin } from "@/lib/jarvis/v2/connections";
import { channelFor, exchangeToken, getYoutube, saveYoutube } from "@/lib/jarvis/songs/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await verifySession();
  const origin = siteOrigin(req);
  const back = (msg: string) => NextResponse.redirect(`${origin}/jarvis/songs?${msg}`);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("jarvis_yt_state")?.value;
  jar.delete({ name: "jarvis_yt_state", path: "/jarvis/api/songs/youtube" });

  if (url.searchParams.get("error")) return back(`yt_error=${encodeURIComponent(url.searchParams.get("error") || "denied")}`);
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("yt_error=state_mismatch");

  const tok = await exchangeToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: `${origin}/jarvis/api/songs/youtube/callback`,
  });
  if (!tok.access_token) return back(`yt_error=${encodeURIComponent(tok.error_description || tok.error || "token exchange failed")}`);
  try {
    const channel = await channelFor(tok.access_token);
    const prev = await getYoutube();
    const refreshToken = tok.refresh_token ?? (prev?.channelId === channel.id ? prev.refreshToken : null);
    if (!refreshToken) return back("yt_error=no_refresh_token");
    await saveYoutube({
      refreshToken,
      channelId: channel.id,
      channelTitle: channel.title,
      playlistId: prev?.channelId === channel.id ? prev.playlistId : undefined,
    });
    return back(`yt_connected=${encodeURIComponent(channel.title)}`);
  } catch (e) {
    return back(`yt_error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
}
