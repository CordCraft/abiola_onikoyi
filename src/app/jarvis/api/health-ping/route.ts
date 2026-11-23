import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { recordPhoneUse } from "@/lib/jarvis/health/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Jarvis app itself counts as phone use: every time it comes to the
// foreground the browser posts here, which sharpens the sleep estimate.
export async function POST() {
  try {
    await verifySession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await recordPhoneUse(new Date(), "jarvis-app");
  return NextResponse.json({ ok: true });
}
