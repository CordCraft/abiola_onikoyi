import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/session";
import { finishLike, likeSong, listSongs, view } from "@/lib/jarvis/songs/service";
import { YtAuthError } from "@/lib/jarvis/songs/ytmusic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Liked songs, newest first (iPhone app Songs screen and /jarvis/songs).
export async function GET() {
  if (!(await getSession())) return unauthorized();
  return NextResponse.json({ songs: await listSongs(60) }, { headers: { "cache-control": "no-store" } });
}

// Like a song. Body: {} = whatever is playing on YouTube Music now (the
// Control Center button and Siri); { url } = a shared YouTube / YouTube Music
// link; { title, artist } = typed by hand. Answers within a second or two;
// the playlist add, the Suno pack and the "ready" push follow in after().
export async function POST(req: Request) {
  if (!(await getSession())) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { url?: string; videoId?: string; title?: string; artist?: string; source?: string };
  try {
    const { song, duplicate } = await likeSong(body);
    if (!duplicate) after(() => finishLike(song.id));
    const v = view(song);
    return NextResponse.json({
      ok: true,
      duplicate,
      song: v,
      // What Siri says and what the app shows straight away
      speech: duplicate ? `Already saved ${v.title}.` : `Saved ${v.title}${v.artist ? ` by ${v.artist}` : ""}. Your Suno version is on its way.`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the song";
    return NextResponse.json({ error: message, needsSetup: e instanceof YtAuthError }, { status: e instanceof YtAuthError ? 412 : 400 });
  }
}
