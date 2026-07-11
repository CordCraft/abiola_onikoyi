import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// External capture endpoint for automations (Apple Shortcuts, Tasker, Zapier,
// email rules). Authenticated with the CRON_SECRET header, not a session, so
// "Hey Siri, note to Jarvis" works without a browser.
//
// POST { "text": "...", "name": "optional-document-name" }
//   - with name  -> stored as a document
//   - without    -> stored as an inbox capture note
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-capture-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { text?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });

  const name = (body.name ?? "").trim();
  if (name) {
    const doc = await prisma.jarvisDocument.create({
      data: { name: name.slice(0, 200), content: text.slice(0, 400_000) },
    });
    return NextResponse.json({ ok: true, kind: "document", id: doc.id });
  }

  const note = await prisma.jarvisNote.create({
    data: { body: text.slice(0, 4000), source: "capture" },
  });
  return NextResponse.json({ ok: true, kind: "capture", id: note.id });
}
