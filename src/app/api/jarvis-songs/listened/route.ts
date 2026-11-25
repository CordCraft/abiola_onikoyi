import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { saveMeasurements } from "@/lib/jarvis/songs/service";
import type { AudioMeasurements } from "@/lib/jarvis/songs/listen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Callback from the voice service (services/voice/music.py) with what it
// measured in the song, authenticated with x-voice-secret.
export async function POST(req: Request) {
  const expected = process.env.VOICE_SECRET || "";
  const got = req.headers.get("x-voice-secret") || "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as (AudioMeasurements & { songId?: string }) | null;
  if (!body?.songId) return NextResponse.json({ error: "songId is required" }, { status: 400 });
  const { songId, ...m } = body;
  after(() => saveMeasurements(songId, m));
  return NextResponse.json({ ok: true });
}
