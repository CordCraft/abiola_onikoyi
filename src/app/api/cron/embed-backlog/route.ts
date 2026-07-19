import { NextResponse } from "next/server";
import { embedBacklog } from "@/lib/jarvis/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Embeds any documents/notes that are not yet in the vector index. Runs
// nightly, and can be triggered manually right after VOYAGE_API_KEY is added
// to backfill the existing library.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // Housekeeping: clear turn checkpoints that were never resumed (client
  // closed the tab mid-turn). They are only valid for seconds anyway.
  const { prisma } = await import("@/lib/prisma");
  await prisma.jarvisTurnState
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3600e3) } } })
    .catch(() => {});

  const result = await embedBacklog(25);
  return NextResponse.json({ ok: true, ...result });
}
