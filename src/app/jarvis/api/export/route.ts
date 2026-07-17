import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { buildExportPayload } from "@/lib/jarvis/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full data export: the durable asset is the memory store, so it must always
// be portable. One JSON file with everything.
export async function GET() {
  try {
    await verifySession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await buildExportPayload();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
