import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendPushToAll, type PushPayload } from "@/lib/jarvis/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Railway listener sends its notifications through here, so the VAPID keys
// stay only in Netlify. Auth: header x-listener-key = LISTENER_ADMIN_KEY.
export async function POST(req: Request) {
  const expected = process.env.LISTENER_ADMIN_KEY || "";
  const given = req.headers.get("x-listener-key") || "";
  const ok = expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const p = (await req.json().catch(() => null)) as (PushPayload & { urgent?: boolean }) | null;
  if (!p?.title || !p.url) return NextResponse.json({ error: "title and url required" }, { status: 400 });
  const result = await sendPushToAll({
    title: String(p.title).slice(0, 120),
    body: String(p.body ?? "").slice(0, 400),
    url: String(p.url),
    tag: p.tag,
    actions: Array.isArray(p.actions) ? p.actions.slice(0, 2) : undefined,
    taskId: p.taskId,
    signalId: p.signalId,
  });
  return NextResponse.json(result);
}
