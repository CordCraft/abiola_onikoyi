import { NextResponse, after } from "next/server";
import { runTurnStep, siteBase, type TurnStep } from "@/lib/jarvis/app-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal: one step of a reply turn (see src/lib/jarvis/app-turn.ts).
// Answers 202 at once and does the work after the response, so the caller
// (the reply route, or the previous step) never waits on the model.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const step = (await req.json().catch(() => null)) as TurnStep | null;
  if (!step || (!step.message && !step.resumeStateId)) return NextResponse.json({ error: "message or resumeStateId required" }, { status: 400 });
  const base = siteBase(req);
  after(() => runTurnStep(step, base));
  return NextResponse.json({ ok: true }, { status: 202 });
}
