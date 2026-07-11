import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

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

  const [ventures, projects, tasks, notes, decisions, goals, milestones, documents, threads, messages] =
    await Promise.all([
      prisma.jarvisVenture.findMany(),
      prisma.jarvisProject.findMany(),
      prisma.jarvisTask.findMany(),
      prisma.jarvisNote.findMany(),
      prisma.jarvisDecision.findMany(),
      prisma.jarvisGoal.findMany(),
      prisma.jarvisMilestone.findMany(),
      prisma.jarvisDocument.findMany(),
      prisma.jarvisThread.findMany(),
      prisma.jarvisMessage.findMany(),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    site: "abiolaonikoyi.com/jarvis",
    ventures,
    projects,
    tasks,
    notes,
    decisions,
    goals,
    milestones,
    documents,
    threads,
    messages,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
