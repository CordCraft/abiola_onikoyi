import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSetting, setSetting } from "@/lib/jarvis/sync/store";
import { cleanCookie, getYtAuth, recentPlays, saveYtAuth } from "@/lib/jarvis/songs/ytmusic";
import { getYoutube, saveYoutube } from "@/lib/jarvis/songs/youtube";
import { STYLE_NOTES_KEY } from "@/lib/jarvis/songs/service";
import { falConfigured } from "@/lib/jarvis/songs/fal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

async function status() {
  const [yt, channel, notes] = await Promise.all([getYtAuth(), getYoutube(), getSetting(STYLE_NOTES_KEY).catch(() => null)]);
  return {
    ytMusic: yt?.cookie ? { connected: true, savedAt: yt.savedAt ?? null, authUser: yt.authUser ?? "0", brand: Boolean(yt.pageId) } : { connected: false },
    youtube: channel ? { connected: true, channel: channel.channelTitle, playlist: Boolean(channel.playlistId) } : { connected: false },
    styleNotes: notes ?? "",
    aceStep: falConfigured(),
    googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

export async function GET() {
  if (!(await getSession())) return unauthorized();
  return NextResponse.json(await status());
}

// { cookie, authUser?, pageId? }   connect YouTube Music (tested before saving)
// { disconnect: "ytmusic" | "youtube" }
// { styleNotes }                    standing notes about the Novale sound
// { test: true }                    what YouTube Music says is playing now
export async function POST(req: Request) {
  if (!(await getSession())) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as {
    cookie?: string;
    authUser?: string;
    pageId?: string;
    disconnect?: string;
    styleNotes?: string;
    test?: boolean;
  };
  try {
    if (b.disconnect === "ytmusic") await saveYtAuth(null);
    if (b.disconnect === "youtube") await saveYoutube(null);
    if (typeof b.styleNotes === "string") await setSetting(STYLE_NOTES_KEY, b.styleNotes.trim().slice(0, 1500));

    let plays = null;
    if (b.cookie) {
      const previous = await getYtAuth();
      const cookie = cleanCookie(b.cookie);
      await saveYtAuth({ cookie, authUser: b.authUser?.trim() || "0", pageId: b.pageId?.trim() || undefined });
      try {
        plays = await recentPlays(3);
      } catch (e) {
        await saveYtAuth(previous); // keep the old one if the new one does not work
        throw e;
      }
    } else if (b.test) {
      plays = await recentPlays(3);
    }
    return NextResponse.json({ ok: true, plays, ...(await status()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed", ...(await status()) }, { status: 400 });
  }
}
