import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildToday } from "@/lib/jarvis/mobile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What's left today, ordered: the iPhone app home screen, its widgets and the
// Siri "what's left today" answer all read this.
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 25, 1), 100);
  return NextResponse.json(await buildToday(limit), { headers: { "cache-control": "no-store" } });
}
