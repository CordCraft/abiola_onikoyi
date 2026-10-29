import { NextResponse } from "next/server";
import { runSync } from "@/lib/jarvis/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pulls GitHub commits/PRs, Netlify deploys and Supabase project status into
// Jarvis. Triggered every 30 minutes by netlify/functions/sync-sources.mts.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const status = await runSync();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
