import { NextResponse } from "next/server";
import { generateWeeklyPost } from "@/lib/generate-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Invoked weekly by the Netlify scheduled function (and protected by a shared
// secret so it can't be triggered by the public). Generates one draft post.
export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const post = await generateWeeklyPost();
    return NextResponse.json({
      ok: true,
      id: post.id,
      title: post.title,
      kind: post.kind,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
