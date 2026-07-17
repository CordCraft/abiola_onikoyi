import { NextResponse } from "next/server";
import { buildExportPayload } from "@/lib/jarvis/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Machine-facing export for the weekly backup function. Lives outside the
// session-protected /jarvis tree; authenticated by the cron secret instead.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await buildExportPayload();
  return NextResponse.json(payload);
}
