import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { forwardAudio } from "@/lib/jarvis/songs/listen";
import { listenFinished } from "@/lib/jarvis/songs/service";
import { authMachine, json, ownedJob, toJson, unauthorized } from "../../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO = 5_500_000; // Netlify caps request bodies near 6MB

// POST raw audio bytes (content-type audio/webm, audio/mp4, ...) for a
// song_listen job. Forwards them to the voice service, which analyses the
// song and calls back /api/jarvis-songs/listened. The audio is not kept.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  const { id } = await ctx.params;
  const job = await ownedJob(machine, id);
  if (!job || job.kind !== "song_listen") return json({ ok: false, error: "Not found" }, 404);
  const songId = String((job.payload as { songId?: string } | null)?.songId ?? "");
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return json({ ok: false, error: "Empty audio" }, 400);
  if (bytes.byteLength > MAX_AUDIO) return json({ ok: false, error: "Audio too large" }, 413);
  const type = req.headers.get("content-type") || "audio/webm";
  const ext = type.includes("mp4") || type.includes("m4a") ? "m4a" : type.includes("mpeg") ? "mp3" : type.includes("ogg") ? "ogg" : "webm";
  try {
    await forwardAudio(songId, new Blob([bytes], { type }), `song.${ext}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "forward failed";
    await prisma.jarvisJob.update({ where: { id }, data: { status: "failed", error: msg, finishedAt: new Date() } });
    after(() => listenFinished(id, msg));
    return json({ ok: false, error: msg }, 502);
  }
  await prisma.jarvisJob.update({
    where: { id },
    data: { status: "done", finishedAt: new Date(), result: toJson({ text: `Sent ${(bytes.byteLength / 1048576).toFixed(1)}MB of audio for analysis.`, exitCode: 0 }) },
  });
  return json({ ok: true });
}
