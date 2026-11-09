import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { decideSignal } from "@/lib/jarvis/v2/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification buttons ("Do it" / "Not now") post here from the service worker.
export async function POST(req: Request) {
  await verifySession();
  const body = (await req.json().catch(() => ({}))) as { signalId?: string; action?: string };
  if (!body.signalId) return NextResponse.json({ error: "signalId required" }, { status: 400 });
  const message =
    body.action === "approve"
      ? await decideSignal(body.signalId, { action: "approve" })
      : body.action === "dismiss"
        ? await decideSignal(body.signalId, { action: "dismiss" })
        : await decideSignal(body.signalId, { action: "snooze", hours: 3 });
  return NextResponse.json({ ok: true, message });
}
