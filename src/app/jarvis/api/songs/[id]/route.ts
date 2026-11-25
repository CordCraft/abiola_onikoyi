import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { finishLike, getSong, refreshGenerations, startGeneration, swapSong, view, writePack } from "@/lib/jarvis/songs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Song not found" }, { status: 404 });

// One song; also moves any running ACE-Step generation forward.
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return unauthorized();
  const song = await getSong((await params).id);
  if (!song) return notFound();
  const fresh = await refreshGenerations(song).catch(() => song);
  return NextResponse.json({ song: view(fresh) }, { headers: { "cache-control": "no-store" } });
}

// { action: "rewrite", direction? }  new Suno pack from the saved blueprint, optionally steered
// { action: "reanalyze", direction? } research and blueprint again, then a new pack
// { action: "swap", videoId }        "not this one": pick another recent play
// { action: "generate" }             make two takes with ACE-Step (fal)
export async function POST(req: Request, { params }: Ctx) {
  if (!(await getSession())) return unauthorized();
  const id = (await params).id;
  const body = (await req.json().catch(() => ({}))) as { action?: string; direction?: string; videoId?: string };
  const song = await getSong(id);
  if (!song) return notFound();
  try {
    if (body.action === "rewrite" || body.action === "reanalyze") {
      const direction = body.direction?.trim().slice(0, 600) || null;
      await prisma.jarvisSong.update({ where: { id }, data: { status: "writing", stage: body.action === "reanalyze" ? "research" : "writing", error: null } });
      after(() => writePack(id, { direction, redo: body.action === "reanalyze" }));
      return NextResponse.json({ song: view((await getSong(id))!) });
    }
    if (body.action === "swap" && body.videoId) {
      const swapped = await swapSong(id, body.videoId);
      after(() => finishLike(id));
      return NextResponse.json({ song: view(swapped) });
    }
    if (body.action === "generate") {
      return NextResponse.json({ song: view(await startGeneration(id)) });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return unauthorized();
  await prisma.jarvisSong.delete({ where: { id: (await params).id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
