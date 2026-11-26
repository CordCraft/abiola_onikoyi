import { NextResponse, after } from "next/server";
import { siteBase } from "@/lib/jarvis/app-turn";
import { handleWa } from "@/lib/jarvis/wa-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The listener forwards what the owner types in his WhatsApp "Message
// yourself" chat (or asks for the morning list). Auth: x-listener-key.
// POST { text } | { command: "list", reason?: "morning" }
export async function POST(req: Request) {
  const expected = process.env.LISTENER_ADMIN_KEY || "";
  if (!expected || req.headers.get("x-listener-key") !== expected) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { text?: string; command?: string; reason?: string } | null;
  if (!body || (!body.text && !body.command)) return NextResponse.json({ error: "text or command required" }, { status: 400 });
  const base = siteBase(req);
  after(() => handleWa(body, base).catch((e) => console.error("wa-inbox:", e)));
  return NextResponse.json({ ok: true }, { status: 202 });
}
