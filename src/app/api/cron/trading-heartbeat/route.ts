import { NextResponse } from "next/server";
import { ensureTradingTables } from "@/lib/trading/setup";
import { checkHeartbeats } from "@/lib/trading/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every 10 minutes: push an alert for any terminal that has stopped posting.
// Drawdown and margin alerts run inside the ingest route; this is the one
// check that cannot, because a dead feed never calls in.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  await ensureTradingTables();
  const result = await checkHeartbeats();
  return NextResponse.json({ ok: true, ...result });
}
